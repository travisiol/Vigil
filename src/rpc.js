import { summarize } from './parse.js';

const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

export function rpcConfigFromEnv(env = process.env) {
  const key = (env.HELIUS_API_KEY || '').trim();
  const custom = (env.RPC_URL || '').trim();
  let url = PUBLIC_RPC;
  let provider = 'public';
  if (custom) { url = custom; provider = 'custom'; }
  else if (key) { url = `https://mainnet.helius-rpc.com/?api-key=${key}`; provider = 'helius'; }
  // Le RPC public de Solana limite chaque méthode à ~10 appels par 10 secondes.
  const rps = Number(env.RPC_RPS) > 0 ? Number(env.RPC_RPS) : provider === 'public' ? 0.9 : 9;
  return { url, provider, rps, perMethod: provider === 'public' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Limite de débit partagée par tous les jobs qui utilisent le même RPC (une traque et un calcul de rentabilité en même temps).
const SHARED = new Map();

export class Rpc {
  constructor({ url, rps, cache, perMethod = false, provider = 'custom' }) {
    this.url = url;
    this.provider = provider;
    this.interval = 1000 / rps;
    this.perMethod = perMethod; // limite par méthode (RPC public) ou globale (Helius, etc.)
    this.cache = cache;
    if (!SHARED.has(url)) SHARED.set(url, { nextAt: {}, pausedUntil: 0 });
    this.shared = SHARED.get(url);
    this.calls = 0;
    this.cacheHits = 0;
    this.retries = 0;
    this.maxVersion = 0;
  }

  // Espace les départs de requêtes pour rester sous la limite du fournisseur.
  async slot(method) {
    const key = this.perMethod ? method : '*';
    for (;;) {
      const now = Date.now();
      const at = Math.max(now, this.shared.nextAt[key] || 0, this.shared.pausedUntil);
      this.shared.nextAt[key] = at + this.interval;
      if (at > now) await sleep(at - now);
      if (Date.now() >= this.shared.pausedUntil) return; // sinon une pause 429 est tombée entre-temps : on se replace
    }
  }

  async call(method, params) {
    let lastErr;
    for (let attempt = 0; attempt < 10; attempt++) {
      await this.slot(method);
      this.calls++;
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get('retry-after'));
          throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: true, wait: ra > 0 ? ra * 1000 : 0 });
        }
        if (res.status === 401 || res.status === 403) throw new Error(`RPC refusé (HTTP ${res.status}) : vérifie la clé ou l'URL dans .env`);
        const body = await res.json();
        if (body.error) {
          const retryable = body.error.code === 429 || body.error.code === -32005 || /rate|limit|too many/i.test(body.error.message || '');
          throw Object.assign(new Error(`RPC ${method} : ${body.error.message}`), { retryable });
        }
        return body.result;
      } catch (e) {
        lastErr = e;
        const retryable = e.retryable || e.name === 'TimeoutError' || e.name === 'AbortError' || e.cause;
        if (!retryable) throw e;
        this.retries++;
        const wait = Math.max(e.wait || 0, Math.min(12000, 1500 * 2 ** attempt));
        this.shared.pausedUntil = Math.max(this.shared.pausedUntil, Date.now() + wait);
      }
    }
    throw new Error(`RPC ${method} : échec après plusieurs essais (${lastErr?.message})`);
  }

  // Signatures d'une adresse, de la plus récente à la plus ancienne.
  sigsPage(address, before, limit = 1000) {
    const opts = { limit, commitment: 'finalized' };
    if (before) opts.before = before;
    return this.call('getSignaturesForAddress', [address, opts]);
  }

  async tx(sig) {
    const hit = this.cache.get(sig);
    if (hit) { this.cacheHits++; return hit; }
    // Les versions de transaction évoluent (v0, v1…) : on s'aligne sur ce que le RPC réclame.
    let raw;
    for (let i = 0; i < 3; i++) {
      const used = this.maxVersion;
      try {
        raw = await this.call('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: used, commitment: 'finalized' }]);
        break;
      } catch (e) {
        const m = /maxSupportedTransactionVersion"?:\s*(\d+)/.exec(e.message || '');
        if (!m || Number(m[1]) <= used || i === 2) throw e;
        this.maxVersion = Math.max(this.maxVersion, Number(m[1]));
      }
    }
    if (!raw) return null;
    const s = summarize(raw, sig);
    this.cache.put(sig, s);
    return s;
  }

  // Préchargement (Helius) : les transactions d'un wallet absentes du cache, 100 par appel au lieu d'une par appel.
  async prefetch(address, list) {
    if (this.provider !== 'helius' || this.noWindowApi || !list || list.length < 8) return;
    const missing = list.filter((x) => x.time && !this.cache.get(x.signature));
    if (missing.length < 8) return;
    const times = missing.map((x) => x.time);
    await this.windowTxs(address, Math.min(...times) - 1, Math.max(...times) + 1, Math.min(1000, missing.length + 20), 'desc').catch(() => null);
  }

  // Transactions d'une adresse entre deux dates, en ordre chronologique.
  // Méthode propre à Helius (getTransactionsForAddress) : jusqu'à 100 transactions complètes par appel.
  // Renvoie null si le fournisseur ne la propose pas ; l'appelant bascule alors sur la méthode standard.
  async windowTxs(address, from, to, cap, order = 'asc', stop = null, keep = true) {
    if (this.provider !== 'helius' || this.noWindowApi) return null;
    const out = [];
    let token = null;
    do {
      const options = {
        transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, sortOrder: order,
        limit: Math.max(1, Math.min(100, cap - out.length)),
        filters: { blockTime: { gte: from, lte: to }, status: 'succeeded' },
      };
      if (token) options.paginationToken = token;
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await this.call('getTransactionsForAddress', [address, options]);
          break;
        } catch (e) {
          // limite de débit passagère (429) : on attend et on réessaie, sans couper la méthode pour toute l'analyse
          if (/429/.test(String(e.message)) && attempt < 4) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
          if (out.length) throw e;
          if (!/429/.test(String(e.message))) this.noWindowApi = true; // forfait ou fournisseur sans cette méthode
          return null;
        }
      }
      for (const el of res?.data || []) {
        const sig = el.transaction?.signatures?.[0];
        if (!sig || !el.meta) continue;
        const s = summarize(el, sig);
        if (el.slot != null) s.slot = el.slot; // le bloc : sert à repérer le bundle (même bloc que la création)
        if (keep) this.cache.put(sig, s); // keep = false : lecture de masse (retraits d'un exchange), pas gardée dans le cache
        out.push(s);
      }
      token = res?.paginationToken || null;
      if (stop && stop(out)) break; // l'appelant a ce qu'il lui faut
    } while (token && out.length < cap);
    return { txs: out, capped: !!token };
  }

  async balances(addresses) {
    const out = {};
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const res = await this.call('getMultipleAccounts', [chunk, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
      chunk.forEach((a, j) => { out[a] = res?.value?.[j]?.lamports ?? 0; });
    }
    return out;
  }
}
