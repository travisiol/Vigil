/**
 * Surveillance exchange : les ruggers financés par un exchange (Binance, Coinbase…), suivis en continu.
 *
 * Chaque rugger tracé qui a été retiré d'un exchange est ajouté ici avec ses montants exacts.
 * Toutes les 3 min, on relit les nouveaux envois des hot wallets de cet exchange (le sien et les autres connus
 * sous le même nom) et on cherche ces montants à ±0,0001 SOL (règle F Project).
 *  - un wallet qui reçoit le montant = son prochain dev probable (alerte « nouveau dev ») ;
 *  - on le suit (jusqu'à 3 wallets si l'argent repart) ; s'il lance un token, le schéma est confirmé :
 *    même exchange, même montant, deux devs → l'exchange va dans le bot en Modèle d'Échange avec cette plage.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { LABELS } from './labels.js';

const SOL = 1e9;
export const EXWATCH = {
  everySec: 180, // une lecture toutes les 3 min
  tol: 0.0001, // plage F Project pour un exchange
  firstBackSec: 6 * 3600, // première lecture d'un hot wallet : 6 h en arrière au plus
  maxBackSec: 6 * 3600, // après une coupure du serveur, on reprend 6 h en arrière au plus
  capPerRead: 6000,
  followHours: 48, // au-delà, un wallet qui n'a rien lancé est abandonné
  maxHops: 3,
  maxWatches: 80,
  maxHits: 40,
};
const GENERIC = new Set(['Exchange', 'Exchange sans nom', 'Wallet à forte activité']);
const COLD = new Set(['GBrURzmtWujJRTA3Bkvo7ZgWuZYLMMwPCwre7BejJXnK', '42brAgAVNzMBP7aaktPvAmBSPEkehnFQejiZc53EpJFd']);

/** Fusionne deux listes de montants exacts (deux montants à moins de 0,00005 SOL sont le même). */
export const mergeAmounts = (a = [], b = []) => [...a, ...b].filter((x, i, arr) => arr.findIndex((y) => Math.abs(y - x) <= 0.00005) === i);

/** Hot wallets connus d'un exchange (par son nom). */
export function hotWalletsOf(name) {
  if (!name || GENERIC.has(name)) return [];
  return Object.entries(LABELS).filter(([a, l]) => l.type === 'exchange' && l.name === name && !COLD.has(a)).map(([a]) => a);
}

/** La surveillance à créer pour une enquête : null si le dev n'a pas été retiré d'un exchange. */
export function watchFromInvestigation(inv, now = Math.floor(Date.now() / 1000)) {
  const fps = (inv.fingerprints || []).filter((f) => f.kind === 'exchange' || f.kind === 'hot');
  if (!fps.length || inv.advice?.notDev) return null;
  // l'exchange principal : celui du conseil, sinon le premier relevé
  const main = fps.find((f) => f.source === inv.advice?.watch?.address || f.source === inv.tracker?.address) || fps[0];
  const name = main.kind === 'hot' ? 'Exchange sans nom' : main.name;
  const same = fps.filter((f) => f.source === main.source || (!GENERIC.has(name) && f.name === name));
  // montant exact gardé à 6 décimales : la plage ±0,0001 se calcule autour du vrai montant
  const amounts = same.map((f) => Math.round(f.sol * 1e6) / 1e6).filter((x, i, arr) => arr.findIndex((y) => Math.abs(y - x) <= 0.00005) === i);
  const addresses = [...new Set([main.source, ...same.map((f) => f.source), ...hotWalletsOf(name)])];
  const tokens = [...(inv.tokens || []), ...(inv.after || []), ...(inv.siblingTokens || [])];
  const devs = [...new Set([inv.start, ...tokens.map((t) => t.creator), ...(inv.wallets || []).filter((w) => w.tokens > 0).map((w) => w.address)].filter(Boolean))];
  const symbol = tokens.find((t) => t.creator === inv.start)?.symbol || tokens[0]?.symbol || null;
  return {
    id: inv.start, start: inv.start, inv: inv.id, symbol, name, source: main.source, addresses, amounts, devs,
    verdict: inv.advice?.verdict || null, addedAt: now, updatedAt: now, hits: [],
  };
}

export class ExchangeWatch {
  constructor({ file, rpc, log = () => {} }) {
    this.file = file;
    this.rpcFactory = rpc;
    this.log = log;
    this.running = false;
    this.state = { watches: [], removed: [], lastRead: {}, lastTick: null, lastError: null, reads: 0 };
    if (file && existsSync(file)) {
      try { this.state = { ...this.state, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* fichier illisible : on repart de zéro */ }
    }
  }

  save() { if (this.file) writeFileSync(this.file, JSON.stringify(this.state)); }

  /** Ajoute (ou met à jour) la surveillance d'un rugger à partir d'une enquête. */
  addFromInvestigation(inv, now = Math.floor(Date.now() / 1000), { backfill = false } = {}) {
    const w = watchFromInvestigation(inv, now);
    if (!w) return null;
    // retiré à la main : pas remis au redémarrage, seulement si tu le retraces
    this.state.removed ||= [];
    if (this.state.removed.includes(w.id)) { if (backfill) return null; this.state.removed = this.state.removed.filter((x) => x !== w.id); }
    const old = this.state.watches.find((x) => x.id === w.id);
    if (old) {
      Object.assign(old, { ...w, amounts: mergeAmounts(old.amounts, w.amounts), addresses: [...new Set([...old.addresses, ...w.addresses])], devs: [...new Set([...old.devs, ...w.devs])], kinds: old.kinds, reused: old.reused, dossier: old.dossier, addedAt: old.addedAt, hits: old.hits, removed: false });
    } else {
      this.state.watches.unshift(w);
      // un nouveau hot wallet : la traque a lu ses envois jusqu'à son heure, on reprend de là (6 h en arrière au plus)
      const at = inv.createdAt ? Math.floor(inv.createdAt / 1000) : now - 600;
      for (const a of w.addresses) if (!this.state.lastRead[a]) this.state.lastRead[a] = Math.max(now - EXWATCH.firstBackSec, Math.min(now - 600, at));
    }
    this.state.watches = this.state.watches.slice(0, EXWATCH.maxWatches);
    this.save();
    return old || w;
  }

  /**
   * Enrichit la surveillance avec le dossier exchange : montants du dev et de son bundle, autres devs connus,
   * wallets de bundle à lui (pas des alertes), et ceux qu'il réutilise d'un token à l'autre.
   */
  enrich(d, now = Math.floor(Date.now() / 1000)) {
    if (d.kind !== 'exchange') return null;
    this.state.removed = (this.state.removed || []).filter((x) => x !== d.start);
    let w = this.state.watches.find((x) => x.id === d.start);
    if (!w) {
      w = { id: d.start, start: d.start, inv: d.inv, symbol: d.symbol, name: d.exchange, source: d.hot, addresses: [], amounts: [], devs: [d.start], verdict: null, addedAt: now, updatedAt: now, hits: [] };
      this.state.watches.unshift(w);
    }
    const amounts = (d.watchAmounts || []).map((a) => Math.round(a.sol * 1e6) / 1e6);
    w.amounts = mergeAmounts(w.amounts, amounts);
    w.kinds = { ...(w.kinds || {}) };
    for (const a of d.watchAmounts || []) w.kinds[String(Math.round(a.sol * 1e6) / 1e6)] = a.kind;
    const addrs = [d.hot, ...(d.watchAmounts || []).map((a) => a.hot), ...hotWalletsOf(d.exchange)].filter(Boolean);
    for (const a of addrs) if (!w.addresses.includes(a)) { w.addresses.push(a); if (!this.state.lastRead[a]) this.state.lastRead[a] = now - 600; }
    w.devs = [...new Set([...w.devs, ...(d.fundings || []).map((f) => f.dev), ...(d.mine || []), ...(d.others || []).map((o) => o.creator)])];
    w.reused = (d.reused || []).filter((r) => r.tokens >= 2).map((r) => r.wallet);
    w.dossier = { status: d.verdict?.status || null, title: d.verdict?.title || null, at: now };
    w.symbol = w.symbol || d.symbol;
    w.updatedAt = now;
    this.save();
    return w;
  }

  remove(id) {
    this.state.watches = this.state.watches.filter((w) => w.id !== id);
    this.state.removed = [...new Set([...(this.state.removed || []), id])].slice(-500);
    this.save();
  }

  list() {
    const active = this.state.watches;
    const addrs = new Set(active.flatMap((w) => w.addresses));
    return { ...this.state, hotWallets: addrs.size, everySec: EXWATCH.everySec, running: this.running };
  }

  /** Une lecture : nouveaux envois des hot wallets, puis suivi des wallets qui ont reçu un montant. */
  async tick(now = Math.floor(Date.now() / 1000)) {
    if (this.running || !this.state.watches.length) return this.list();
    this.running = true;
    try {
      const rpc = this.rpcFactory();
      if (!rpc.windowTxs) { this.state.lastError = 'La surveillance a besoin d’une clé Helius.'; return this.list(); }
      // montants cherchés par hot wallet
      const byAddr = new Map();
      for (const w of this.state.watches) for (const a of w.addresses) { if (!byAddr.has(a)) byAddr.set(a, []); byAddr.get(a).push(w); }
      let errors = 0;
      for (const [addr, watches] of byAddr) {
        const from = Math.max(this.state.lastRead[addr] ?? now - EXWATCH.firstBackSec, now - EXWATCH.maxBackSec);
        const r = await rpc.windowTxs(addr, from, now, EXWATCH.capPerRead, 'desc', null, false).catch(() => null);
        if (!r) { errors++; continue; }
        this.state.reads += r.txs.length;
        this.state.lastRead[addr] = now;
        for (const t of r.txs) {
          for (const tr of t.transfers || []) {
            if (tr.from !== addr) continue;
            const s = tr.lamports / SOL;
            for (const w of watches) {
              const amount = w.amounts.find((a) => Math.abs(a - s) <= EXWATCH.tol + 1e-9);
              if (amount == null || w.devs.includes(tr.to) || w.hits.some((h) => h.to === tr.to)) continue;
              w.hits.unshift({ to: tr.to, cur: tr.to, path: [tr.to], from: addr, sol: s, amount, sig: t.sig, time: t.time, seenAt: now, status: 'waiting', checkedAt: 0 });
              w.hits = w.hits.slice(0, EXWATCH.maxHits);
              w.updatedAt = now;
              this.log(`Surveillance : ${tr.to.slice(0, 4)}… a reçu ${s.toFixed(4)} SOL de ${w.name} (rugger ${w.start.slice(0, 4)}…)`);
            }
          }
        }
      }
      // ses wallets de bundle réutilisés : un achat à la naissance d'un token = son nouveau lancement
      for (const w of this.state.watches) {
        for (const bw of w.reused || []) {
          const key = `reuse:${bw}`;
          const from = Math.max(this.state.lastRead[key] ?? now - 1800, now - EXWATCH.maxBackSec);
          const r = await rpc.windowTxs(bw, from, now, 200, 'desc', null, false).catch(() => null);
          if (!r) continue;
          this.state.lastRead[key] = now;
          for (const t of r.txs) {
            if (!t.pump || t.create) continue;
            const d = (t.tokenDelta || []).find((x) => x.owner === bw && x.delta > 0);
            if (!d || w.hits.some((h) => h.mint === d.mint)) continue;
            const first = await rpc.windowTxs(d.mint, 0, t.time + 1, 5, 'asc', null, false).catch(() => null);
            const cr = first?.txs.find((x) => x.create?.mint === d.mint);
            if (!cr || t.time - cr.time > 3) continue;
            w.hits.unshift({ to: bw, cur: bw, path: [bw], from: null, sol: 0, amount: null, sig: t.sig, time: t.time, seenAt: now, status: 'created', viaReuse: true, creator: cr.feePayer, mint: d.mint, symbol: cr.create.symbol || null, tokenName: cr.create.name || null, createdAt: cr.time, delay: 0, checkedAt: now });
            w.hits = w.hits.slice(0, EXWATCH.maxHits);
            w.updatedAt = now;
            this.log(`Surveillance : son wallet de bundle ${bw.slice(0, 4)}… a snipé ${cr.create.symbol || d.mint} à sa naissance`);
          }
        }
      }
      // suivi des nouveaux devs probables
      for (const w of this.state.watches) {
        for (const h of w.hits) {
          if (h.status !== 'waiting' || now - h.checkedAt < EXWATCH.everySec - 5) continue;
          if (now - h.time > EXWATCH.followHours * 3600) { h.status = 'expired'; continue; }
          h.checkedAt = now;
          await this.follow(rpc, w, h, now).catch(() => {});
        }
        w.confirmed = w.hits.some((h) => h.status === 'created');
      }
      this.state.lastTick = now;
      this.state.lastError = errors && errors === byAddr.size ? 'Lecture des exchanges impossible (Helius indisponible ?)' : null;
      this.save();
      return this.list();
    } finally {
      this.running = false;
    }
  }

  /** Le wallet qui a reçu le montant a-t-il lancé un token ? Sinon, son argent est-il parti vers un autre wallet ? */
  async follow(rpc, w, h, now) {
    for (let hop = 0; hop < EXWATCH.maxHops; hop++) {
      const page = await rpc.sigsPage(h.cur, undefined, 100).catch(() => []);
      const recent = page.filter((x) => !x.err && (x.blockTime == null || x.blockTime >= h.time)).slice(0, 40);
      const txs = (await Promise.all(recent.map((x) => Promise.resolve().then(() => rpc.tx(x.signature)).catch(() => null)))).filter(Boolean).sort((a, b) => a.time - b.time);
      // un dev de rugger est un wallet neuf : un wallet déjà bien utilisé avant de recevoir le montant est un simple client
      if (hop === 0 && page.filter((x) => x.blockTime && x.blockTime < h.time).length >= 20) { h.status = 'notfresh'; return; }
      const made = txs.find((t) => t.create && (t.feePayer === h.cur || (t.signers || []).includes(h.cur)));
      if (made) {
        Object.assign(h, { status: 'created', creator: h.cur, mint: made.create.mint, symbol: made.create.symbol || null, tokenName: made.create.name || null, createdAt: made.time, delay: made.time - h.time });
        w.updatedAt = now;
        this.log(`Surveillance : schéma confirmé, ${h.cur.slice(0, 4)}… a lancé ${made.create.symbol || made.create.mint}`);
        return;
      }
      // wallet de bundle : il achète un token dans les 3 s qui suivent sa création → c'est son nouveau lancement
      const buy = txs.find((t) => t.pump && !t.create && (t.tokenDelta || []).some((d) => d.owner === h.cur && d.delta > 0));
      if (buy && rpc.windowTxs) {
        const mint = buy.tokenDelta.find((d) => d.owner === h.cur && d.delta > 0).mint;
        const first = await rpc.windowTxs(mint, 0, buy.time + 1, 5, 'asc', null, false).catch(() => null);
        const cr = first?.txs.find((t) => t.create?.mint === mint);
        if (cr && buy.time - cr.time <= 3) {
          Object.assign(h, { status: 'created', viaBundle: true, creator: cr.feePayer, mint, symbol: cr.create.symbol || null, tokenName: cr.create.name || null, createdAt: cr.time, delay: cr.time - h.time });
          w.updatedAt = now;
          this.log(`Surveillance : son wallet de bundle ${h.cur.slice(0, 4)}… a acheté ${cr.create.symbol || mint} à sa naissance`);
          return;
        }
      }
      // l'argent repart en entier vers un autre wallet (relais) : on le suit
      const out = txs.flatMap((t) => (t.transfers || []).filter((x) => x.from === h.cur && x.to !== h.cur && x.lamports >= 0.5 * h.sol * SOL));
      const next = out.sort((a, b) => b.lamports - a.lamports)[0];
      if (!next || h.path.includes(next.to) || LABELS[next.to]) return;
      h.cur = next.to;
      h.path.push(next.to);
    }
  }
}
