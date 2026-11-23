// Recherche de ruggers : passe en revue les tokens pump.fun récents (New Pairs) et proches de la
// migration (Final Stretch), garde ceux qui ont assez de volume, puis cherche les signes de rug.
import { TOL } from './census.js';
import { labelOf } from './labels.js';
import { gecko } from './gecko.js';

const SOL = 1e9;
const MINT_AUTH = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'; // signe chaque création pump.fun
const SUPPLY = 1e9;
// Courbe pump.fun : 30 SOL et 1,073 Md de tokens virtuels au départ, 793,1 M de tokens à vendre avant migration.
const V_TOK0 = 1.073e9, K = 30 * V_TOK0, FOR_SALE = 793.1e6;
const GRAD_PRICE = K / (V_TOK0 - FOR_SALE) ** 2;
const P0 = 30 / V_TOK0; // prix de départ, en SOL
const WSOL = 'So11111111111111111111111111111111111111112';

/** Avancement vers la migration (0 à 1) à partir du prix en SOL. */
export function progressOf(priceSol) {
  if (!(priceSol > 0)) return null;
  return Math.max(0, Math.min(1, (V_TOK0 - Math.sqrt(K / priceSol)) / FOR_SALE));
}

const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fr = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}


export const SCAN_DEFAULTS = { minVolume: 15000, maxAgeMin: 10, newPairs: true, finalStretch: true, deep: 3, finalProgress: 0.7, singleCreateOnly: true };

/**
 * @param rpc      client Solana (src/rpc.js)
 * @param optsIn   voir SCAN_DEFAULTS
 * @param emit     événements : { type: 'log' | 'tokens', ... }
 * @param known    Map adresse -> { id, start, rugs } : wallets déjà vus dans les enquêtes enregistrées
 */
export async function scan(rpc, optsIn, emit = () => {}, known = new Map()) {
  const opts = { ...SCAN_DEFAULTS, maxCreates: rpc.perMethod ? 150 : 600, ...optsIn };
  const log = (msg) => emit({ type: 'log', msg });
  const now = Math.floor(Date.now() / 1000);
  const found = new Map(); // mint -> token

  // ---------- 1. New Pairs : créations lues sur la chaîne ----------
  let createsSeen = 0;
  let coveredMin = 0;
  if (opts.newPairs) {
    log(`New Pairs : lecture des créations pump.fun des ${opts.maxAgeMin} dernières minutes`);
    const since = now - opts.maxAgeMin * 60;
    let list = [], before, reached = false;
    for (let page = 0; page < 3 && !reached; page++) {
      const p = await rpc.sigsPage(MINT_AUTH, before, 1000);
      list.push(...p);
      before = p[p.length - 1]?.signature;
      reached = p.length < 1000 || (p[p.length - 1].blockTime ?? 0) < since;
    }
    const inWin = list.filter((s) => !s.err && (s.blockTime ?? 0) >= since);
    const pick = inWin.slice(0, opts.maxCreates);
    coveredMin = pick.length ? (now - pick[pick.length - 1].blockTime) / 60 : 0;
    if (inWin.length > pick.length) log(`${inWin.length} créations sur la période : lecture des ${pick.length} plus récentes (${fr(coveredMin, 1)} min couvertes)`);
    for (let i = 0; i < pick.length; i += 50) {
      const txs = await Promise.all(pick.slice(i, i + 50).map((s) => rpc.tx(s.signature).catch(() => null)));
      for (const t of txs) {
        if (!t?.create) continue;
        createsSeen++;
        const dev = t.tokenDelta.find((d) => d.owner === t.feePayer && d.mint === t.create.mint);
        found.set(t.create.mint, {
          mint: t.create.mint, name: t.create.name, symbol: t.create.symbol, source: ['new'], createdAt: t.time, creator: t.feePayer, createSig: t.sig,
          devSupplyPct: dev ? dev.delta / SUPPLY : 0, devBuySol: Math.max(0, -(t.solDelta[t.feePayer] || 0)) / SOL,
        });
      }
      if (pick.length > 50) log(`Créations lues : ${Math.min(i + 50, pick.length)} / ${pick.length}`);
    }
    log(`${createsSeen} token${createsSeen > 1 ? 's' : ''} créé${createsSeen > 1 ? 's' : ''} sur la période lue`);
  }

  // ---------- 2. Final Stretch : gros volumes encore sur la courbe, proches de la migration ----------
  let finalError = null;
  if (opts.finalStretch) {
    log('Final Stretch : tokens pump.fun à fort volume proches de la migration');
    try {
      for (const page of [1, 2]) {
        const j = await gecko(`dexes/pump-fun/pools?page=${page}&sort=h24_volume_usd_desc`);
        for (const d of j.data || []) {
          const a = d.attributes;
          const price = Number(a.base_token_price_native_currency);
          const prog = progressOf(price);
          const mint = d.relationships?.base_token?.data?.id?.replace('solana_', '');
          if (!mint || price > GRAD_PRICE * 1.02 || prog == null || prog < opts.finalProgress) continue;
          const t = found.get(mint) || { mint, name: a.name.split(' / ')[0], symbol: a.name.split(' / ')[0], source: [], createdAt: Math.floor(Date.parse(a.pool_created_at) / 1000), creator: null };
          if (!t.source.includes('final')) t.source.push('final');
          found.set(mint, t);
        }
      }
    } catch (e) {
      finalError = e.status === 429 ? 'limite de requêtes GeckoTerminal atteinte' : e.message;
      log(`Final Stretch indisponible pour cette recherche (${finalError})`);
    }
  }

  // ---------- 3. volume, prix, achats et ventes (DexScreener) ----------
  const mints = [...found.keys()];
  log(`Volume et prix de ${mints.length} token${mints.length > 1 ? 's' : ''}`);
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    let pairs = [];
    try { pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`); } catch { /* marché inconnu pour ce lot */ }
    // Un token peut avoir plusieurs paires (la courbe pump.fun, puis un pool après migration).
    // On ne garde que les paires cotées en SOL : le prix « natif » des autres n'est pas en SOL.
    const byMint = new Map();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      if (p.quoteToken?.address !== WSOL || !found.has(p.baseToken?.address)) continue;
      if (!byMint.has(p.baseToken.address)) byMint.set(p.baseToken.address, []);
      byMint.get(p.baseToken.address).push(p);
    }
    for (const [mint, list] of byMint) {
      const t = found.get(mint);
      const amm = list.filter((p) => p.dexId !== 'pumpfun').sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      const p = amm || list[0]; // après migration, c'est le pool qui fait le prix
      const sum = (k) => list.reduce((s, x) => s + (x.volume?.[k] ?? 0), 0);
      t.market = {
        pair: p.pairAddress, dex: p.dexId, migrated: !!amm, priceSol: Number(p.priceNative) || null, priceUsd: Number(p.priceUsd) || null,
        marketCap: p.marketCap ?? p.fdv ?? null, liquidityUsd: p.liquidity?.usd ?? 0,
        volume: { m5: sum('m5'), h1: sum('h1'), h24: sum('h24') },
        change: { m5: p.priceChange?.m5 ?? null, h1: p.priceChange?.h1 ?? null },
        txns: { m5: p.txns?.m5 || { buys: 0, sells: 0 }, h1: p.txns?.h1 || { buys: 0, sells: 0 } },
      };
      if (!t.name && p.baseToken?.name) { t.name = p.baseToken.name; t.symbol = p.baseToken.symbol; }
    }
  }

  // ---------- 4. filtres ----------
  const tokens = [];
  for (const t of found.values()) {
    if (!t.market) continue;
    t.ageMin = (now - t.createdAt) / 60;
    t.migrated = t.market.migrated;
    t.progress = t.migrated ? 1 : progressOf(t.market.priceSol);
    // Final Stretch = encore sur la courbe et proche de la migration, d'après le prix réel
    const stretch = !t.migrated && t.progress != null && t.progress >= opts.finalProgress;
    t.source = t.source.filter((x) => x !== 'final');
    if (stretch && opts.finalStretch) t.source.push('final');
    if (!t.source.length) continue;
    if (t.market.volume.h24 < opts.minVolume) continue;
    if (!t.source.includes('final') && t.ageMin > opts.maxAgeMin) continue;
    score(t, known);
    tokens.push(t);
  }

  // ---------- 4 bis. un seul token par dev ----------
  // Un dev qui a déjà créé un autre token (même adresse réutilisée) n'est pas une cible : on l'écarte.
  const sigMemo = new Map();
  let multiDev = 0;
  async function devCreates(creator, mint, index) {
    const seen = new Set([mint, ...(index.get(creator) || [])]);
    if (seen.size >= 2) return { creates: seen.size, checked: 'cache' };
    const s = await sigs(creator, 1);
    if (!s.complete) return { creates: 2, checked: 'busy' }; // plus de 1 000 transactions : il lance en série
    const ok = s.list.filter((x) => !x.err);
    const pick = ok.slice(0, 60);
    for (let i = 0; i < pick.length && seen.size < 2; i += 20) {
      const txs = await Promise.all(pick.slice(i, i + 20).map((x) => rpc.tx(x.signature).catch(() => null)));
      for (const x of txs) if (x?.create && x.signers.includes(creator)) seen.add(x.create.mint);
    }
    return { creates: seen.size, checked: ok.length > pick.length ? 'partial' : 'full', txCount: s.list.length };
  }
  // Créateur d'un token plus ancien (Final Stretch) : la toute première transaction du token.
  async function findCreator(t) {
    const s = await sigs(t.mint, rpc.perMethod ? 6 : 15);
    if (!s.complete) return null; // trop d'historique pour remonter jusqu'au lancement
    for (const o of s.list.slice(-4).reverse()) {
      const x = await rpc.tx(o.signature).catch(() => null);
      if (x?.create?.mint === t.mint) {
        const d = x.tokenDelta.find((v) => v.owner === x.feePayer && v.mint === t.mint);
        return { creator: x.feePayer, createdAt: x.time, devSupplyPct: d ? d.delta / SUPPLY : 0 };
      }
    }
    return null;
  }
  let unknownDev = 0;
  if (opts.singleCreateOnly) {
    const index = rpc.cache?.creators ? rpc.cache.creators() : new Map(); // créations déjà lues : sans appel réseau
    for (const t of tokens.filter((x) => !x.creator)) {
      log(`Recherche du dev de ${t.symbol || short(t.mint)}`);
      const c = await findCreator(t);
      if (c) Object.assign(t, c);
    }
    const withDev = tokens.filter((t) => t.creator);
    if (withDev.length) log(`Contrôle des devs : ${withDev.length} à vérifier (un seul token par dev)`);
    for (const t of withDev) {
      t.dev = await devCreates(t.creator, t.mint, index);
      if (t.dev.creates >= 2) { multiDev++; tokens.splice(tokens.indexOf(t), 1); }
    }
    // un dev introuvable ne peut pas être garanti à un seul token : on l'écarte aussi
    for (const t of tokens.filter((x) => !x.creator)) { unknownDev++; tokens.splice(tokens.indexOf(t), 1); }
    if (multiDev) log(`${multiDev} token${multiDev > 1 ? 's écartés' : ' écarté'} : dev à plusieurs tokens`);
    if (unknownDev) log(`${unknownDev} token${unknownDev > 1 ? 's écartés' : ' écarté'} : dev introuvable (historique trop long)`);
    for (const t of tokens) score(t, known);
  }
  const rank = () => tokens.sort((a, b) => b.score - a.score || b.market.volume.h24 - a.market.volume.h24);
  rank();
  log(`${tokens.length} token${tokens.length > 1 ? 's' : ''} au-dessus de ${fr(opts.minVolume)} $ de volume`);
  emit({ type: 'tokens', tokens });

  // ---------- 5. bougies des plus suspects : chute depuis le plus haut ----------
  // les tokens récents d'abord : leur lancement se relit en entier, pas celui d'un token de 15 heures
  const focus = () => [...tokens].sort((a, b) => (a.ageMin > 60) - (b.ageMin > 60) || b.score - a.score || b.market.volume.h24 - a.market.volume.h24);
  for (const t of focus().slice(0, 3)) {
    try {
      const j = await gecko(`pools/${t.market.pair}/ohlcv/minute?aggregate=1&limit=60`);
      const c = (j.data?.attributes?.ohlcv_list || []).map((x) => x.map(Number)).sort((a, b) => a[0] - b[0]);
      if (c.length < 2) continue;
      const peak = Math.max(...c.map((x) => x[2]));
      t.candles = c.map((x) => [x[0], x[1], x[2], x[3], x[4]]);
      t.drawdown = peak > 0 ? 1 - c[c.length - 1][4] / peak : null;
      t.worstCandle = Math.min(...c.map((x) => (x[1] > 0 ? x[4] / x[1] - 1 : 0)));
      score(t, known);
    } catch (e) {
      if (e.status === 429) { log('Bougies : limite GeckoTerminal atteinte, on continue sans'); break; }
    }
  }
  rank();
  emit({ type: 'tokens', tokens });

  // ---------- 6. analyse on-chain des plus suspects ----------
  async function sigs(address, maxPages) {
    let m = sigMemo.get(address);
    if (!m) { m = { list: [], complete: false, pages: 0 }; sigMemo.set(address, m); }
    while (!m.complete && m.pages < maxPages) {
      const before = m.list.length ? m.list[m.list.length - 1].signature : undefined;
      const page = await rpc.sigsPage(address, before, 1000);
      m.pages++;
      for (const s of page) m.list.push({ signature: s.signature, time: s.blockTime ?? null, err: !!s.err });
      if (page.length < 1000) m.complete = true;
    }
    return m;
  }
  async function funderOf(address) {
    const s = await sigs(address, 1);
    if (!s.complete) return { busy: true, txCount: 1000 };
    const info = { txCount: s.list.length, firstTx: s.list[s.list.length - 1]?.time ?? null };
    for (const o of s.list.filter((x) => !x.err).slice(-3).reverse()) {
      const t = await rpc.tx(o.signature);
      const tr = t?.transfers.filter((x) => x.to === address && x.from !== address).sort((a, b) => b.lamports - a.lamports)[0];
      if (tr) return { ...info, funder: tr.from, lamports: tr.lamports, time: t.time };
    }
    return info;
  }

  // un vieux token dont on ne connaît pas le dev a trop d'historique pour être relu : inutile d'y passer du temps
  const todo = focus().filter((t) => t.ageMin <= 60 || t.creator).slice(0, opts.deep);
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    log(`Analyse on-chain ${i + 1} / ${todo.length} : ${t.symbol || short(t.mint)}`);
    try {
      t.onchain = await deep(t);
      score(t, known);
    } catch (e) {
      log(`Analyse de ${t.symbol || short(t.mint)} interrompue : ${e.message}`);
    }
    rank();
    emit({ type: 'tokens', tokens });
  }

  async function deep(t) {
    const out = { buyers: 0, bundle: 0, bundleSupplyPct: 0, linked: 0, linkedSupplyPct: 0, links: [], dev: null };
    // Un token de 2 minutes a déjà des milliers de transactions (bots, échecs) : on remonte loin pour les tokens récents.
    const sm = await sigs(t.mint, t.ageMin <= 30 ? 15 : 3);
    const ok = sm.list.filter((x) => !x.err);
    out.txCount = sm.list.length;
    out.partial = !sm.complete; // historique trop long : le lancement n'est pas relu, seul le dev est analysé
    const firstTxs = sm.complete ? (await Promise.all(ok.slice(-16).map((x) => rpc.tx(x.signature)))).filter(Boolean).sort((a, b) => (a.time || 0) - (b.time || 0)) : [];
    const createTx = firstTxs.find((x) => x.create?.mint === t.mint);
    if (createTx && !t.creator) {
      t.creator = createTx.feePayer; t.createSig = createTx.sig; t.createdAt = createTx.time;
      const d = createTx.tokenDelta.find((x) => x.owner === t.creator && x.mint === t.mint);
      t.devSupplyPct = d ? d.delta / SUPPLY : 0;
    }
    const dev = t.creator;
    const t0 = createTx?.time ?? t.createdAt;
    // premiers acheteurs (hors dev)
    const buyers = new Map();
    for (const x of firstTxs) {
      for (const d of x.tokenDelta) {
        if (d.mint !== t.mint || d.delta <= 0 || d.owner === dev || !x.signers.includes(d.owner)) continue;
        const b = buyers.get(d.owner) || { wallet: d.owner, tokens: 0, time: x.time };
        b.tokens += d.delta;
        buyers.set(d.owner, b);
      }
    }
    const first = [...buyers.values()].sort((a, b) => a.time - b.time);
    out.buyers = first.length;
    const bundle = first.filter((b) => b.time <= t0);
    out.bundle = bundle.length;
    out.bundleSupplyPct = bundle.reduce((s, b) => s + b.tokens, 0) / SUPPLY;

    // qui a financé le dev et les premiers acheteurs ? des sources communes = wallets liés
    const people = [...(dev ? [{ wallet: dev, isDev: true, tokens: (t.devSupplyPct || 0) * SUPPLY }] : []), ...first.slice(0, 6)];
    for (const p of people) p.f = await funderOf(p.wallet);
    const strong = new Map(); // un financeur ne compte que s'il n'est ni un exchange ni un service
    const isService = async (a) => {
      if (labelOf(a)) return true;
      if (!strong.has(a)) strong.set(a, !(await sigs(a, 1)).complete);
      return strong.get(a);
    };
    const group = new Map(people.map((p) => [p.wallet, p.wallet]));
    const root = (a) => { while (group.get(a) !== a) a = group.get(a); return a; };
    const join = (a, b, why) => { const ra = root(a), rb = root(b); if (ra !== rb) { group.set(ra, rb); out.links.push({ a, b, why }); } };
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const A = people[i], B = people[j];
        if (A.f.funder === B.wallet || B.f.funder === A.wallet) join(A.wallet, B.wallet, 'l\'un a financé l\'autre');
        else if (A.f.funder && A.f.funder === B.f.funder) {
          if (!(await isService(A.f.funder))) join(A.wallet, B.wallet, `même financeur ${short(A.f.funder)}`);
          else if (Math.abs(A.f.lamports - B.f.lamports) <= 0.0001 * SOL) join(A.wallet, B.wallet, `même source et même montant (${fr(A.f.lamports / SOL, 4)} SOL)`);
        }
      }
    }
    const size = new Map();
    for (const p of people) size.set(root(p.wallet), (size.get(root(p.wallet)) || 0) + 1);
    const linked = people.filter((p) => !p.isDev && size.get(root(p.wallet)) >= 2);
    out.linked = linked.length;
    out.checked = people.filter((p) => !p.isDev).length;
    out.linkedSupplyPct = linked.reduce((s, p) => s + p.tokens, 0) / SUPPLY;
    out.linkedToDev = dev ? linked.filter((p) => root(p.wallet) === root(dev)).length : 0;

    if (dev) {
      const me = people.find((p) => p.isDev).f;
      const lab = me.funder ? labelOf(me.funder) : null;
      // le dev a-t-il déjà revendu ?
      const mine = await sigs(dev, 1);
      const recent = (await Promise.all(mine.list.filter((x) => !x.err).slice(0, 5).map((x) => rpc.tx(x.signature)))).filter(Boolean);
      const soldTokens = [...recent, ...firstTxs].reduce((s, x) => s + x.tokenDelta.filter((d) => d.owner === dev && d.mint === t.mint && d.delta < 0).reduce((q, d) => q - d.delta, 0), 0);
      const got = (t.devSupplyPct || 0) * SUPPLY;
      out.dev = {
        wallet: dev, txCount: me.txCount ?? null, busy: !!me.busy, ageMin: me.firstTx ? (now - me.firstTx) / 60 : null,
        funder: me.funder || null, funderLabel: lab?.name || null, fundedSol: me.lamports ? me.lamports / SOL : null,
        soldPct: got > 0 ? Math.min(1, soldTokens / got) : 0,
      };
      // le financeur envoie-t-il ce même montant à d'autres wallets ? (wallet mère, ou exchange + montant exact : trackable)
      if (me.funder && me.lamports) {
        // un financeur sans nom mais très riche (300 SOL ou plus) se comporte comme un exchange : montant exact seulement
        const rich = !lab && ((await rpc.balances([me.funder]).catch(() => ({})))[me.funder] || 0) >= 300 * SOL;
        const ex = lab?.type === 'exchange' || rich;
        const tol = (ex ? TOL.exchange : TOL.mother(me.lamports / SOL)) * SOL;
        let page = null;
        if (rpc.windowTxs) page = await rpc.windowTxs(me.funder, now - 24 * 3600, now, ex ? 3000 : 300, 'desc').catch(() => null);
        const txs = page?.txs || (await Promise.all((await sigs(me.funder, 1)).list.filter((x) => !x.err).slice(0, 60).map((x) => rpc.tx(x.signature)))).filter(Boolean);
        const same = new Set();
        for (const x of txs) for (const tr of x.transfers) if (tr.from === me.funder && tr.to !== dev && !(x.pump && !tr.top) && Math.abs(tr.lamports - me.lamports) <= tol) same.add(tr.to);
        out.dev.sameAmount = same.size;
        out.dev.sameAmountScope = ex ? 'exchange' : 'wallet';
      }
    }
    return out;
  }

  const result = {
    createdAt: Date.now(), options: opts,
    stats: { created: createsSeen, coveredMin, enriched: [...found.values()].filter((t) => t.market).length, kept: tokens.length, multiDev, unknownDev, deep: todo.length, finalError, rpcCalls: rpc.calls },
    tokens,
  };
  log(`Terminé : ${tokens.length} token${tokens.length > 1 ? 's' : ''}, dont ${tokens.filter((t) => t.verdict === 'rug' || t.verdict === 'high').length} à risque élevé ou déjà rug`);
  return result;
}

// Note de risque et liste des signaux, du plus grave au moins grave.
function score(t, known) {
  const m = t.market;
  const sig = [];
  let s = 0;
  const add = (pts, level, text) => { s += pts; sig.push({ level, text, pts }); };
  let dead = false;

  // --- le graphique : chute, retour au prix de départ ---
  if (t.drawdown != null && t.drawdown >= 0.85) { dead = true; add(60, 'bad', `Chute de ${fr(t.drawdown * 100)} % depuis le plus haut`); }
  else if (m.priceSol && m.priceSol <= P0 * 1.3 && m.volume.h24 >= 10000) { dead = true; add(55, 'bad', `Revenu au prix de départ après ${fr(m.volume.h24)} $ de volume`); }
  else if (t.drawdown != null && t.drawdown >= 0.6) add(35, 'bad', `Chute de ${fr(t.drawdown * 100)} % depuis le plus haut`);
  else if (m.change.m5 != null && m.change.m5 <= -50) add(35, 'bad', `${fr(m.change.m5)} % en 5 minutes`);
  else if (m.change.h1 != null && m.change.h1 <= -70) add(30, 'bad', `${fr(m.change.h1)} % sur l'heure`);
  if (t.worstCandle != null && t.worstCandle <= -0.5) add(10, 'bad', `Une bougie rouge de ${fr(t.worstCandle * 100)} % en 1 minute`);
  const tx = m.txns.m5;
  if (tx.sells >= 10 && tx.sells >= 2 * Math.max(1, tx.buys)) add(10, 'warn', `${tx.sells} ventes pour ${tx.buys} achats sur 5 minutes`);

  // --- le lancement et les holders ---
  if (t.devSupplyPct >= 0.1) add(8, 'warn', `Le dev a pris ${fr(t.devSupplyPct * 100)} % de la supply à la création`);
  const o = t.onchain;
  if (o) {
    if (!o.partial) {
      // des snipers achètent sur tous les lancements : seule une grosse part de la supply compte vraiment
      if (o.bundleSupplyPct >= 0.2) add(20, 'bad', `${o.bundle} wallets ont pris ${fr(o.bundleSupplyPct * 100)} % de la supply dans la seconde du lancement`);
      else if (o.bundle >= 1) add(6, 'warn', `${o.bundle} wallet${o.bundle > 1 ? 's ont' : ' a'} acheté dans la seconde du lancement (${fr(o.bundleSupplyPct * 100)} % de la supply)`);
      if (o.linked >= 4) add(30, 'bad', `${o.linked} des ${o.checked} premiers acheteurs sont liés entre eux (${fr(o.linkedSupplyPct * 100)} % de la supply)`);
      else if (o.linked >= 2) add(20, 'bad', `${o.linked} des ${o.checked} premiers acheteurs sont liés entre eux`);
      if (o.linkedToDev) add(10, 'bad', `${o.linkedToDev} premier${o.linkedToDev > 1 ? 's acheteurs liés' : ' acheteur lié'} au dev`);
    } else sig.push({ level: 'info', text: `Plus de ${fr(o.txCount)} transactions : premiers acheteurs non relus`, pts: 0 });
    const d = o.dev;
    if (d) {
      if (d.soldPct >= 0.8) add(20, 'bad', 'Le dev a déjà revendu ses tokens');
      if (!d.busy && d.ageMin != null && d.ageMin < 180 && d.txCount < 60) add(6, 'warn', `Wallet du dev tout neuf (${fr(d.ageMin)} min, ${d.txCount} transactions)`);
      if (d.busy) add(8, 'warn', 'Le dev lance en série (plus de 1 000 transactions)');
      if (d.funderLabel) sig.push({ level: 'info', text: `Dev financé par ${d.funderLabel}${d.fundedSol ? ` (${fr(d.fundedSol, 3)} SOL)` : ''}`, pts: 0 });
      if (d.sameAmount >= 2) {
        t.trackable = { source: d.funder, label: d.funderLabel, sol: d.fundedSol, n: d.sameAmount, kind: d.sameAmountScope };
        add(10, 'warn', `Trackable : ${d.funderLabel || 'son financeur'} a envoyé ce même montant (${fr(d.fundedSol, d.sameAmountScope === 'exchange' ? 4 : 2)} SOL) à ${d.sameAmount} autres wallets en 24 h. Trace-le pour le réglage du bot.`);
      }
    }
  }
  const kDev = t.creator && known.get(t.creator);
  const kSrc = o?.dev?.funder && known.get(o.dev.funder);
  if (kDev && !kDev.source) { t.known = kDev; add(35, 'bad', `Dev déjà dans tes enquêtes : ${kDev.rugs} rug${kDev.rugs > 1 ? 's' : ''} probable${kDev.rugs > 1 ? 's' : ''}`); }
  else if (kSrc?.source) {
    const sol = o.dev.fundedSol;
    const hit = sol != null && kSrc.ranges.some((r) => sol >= r.min - 1e-9 && sol <= r.max + 1e-9);
    // la source d'un rugger déjà tracé finance ce dev, avec un montant de ses plages : c'est très probablement lui
    if (hit || kSrc.kind === 'mother') { t.known = kSrc; add(hit ? 45 : 25, 'bad', `Dev financé par la source d'un rugger déjà tracé (${kSrc.label || short(o.dev.funder)}${sol != null ? `, ${fr(sol, 4)} SOL${hit ? ', dans ses plages' : ''}` : ''})`); }
  } else if (kSrc && !kSrc.source) { t.known = kSrc; add(35, 'bad', `Dev financé par un wallet de tes enquêtes : ${kSrc.rugs} rug${kSrc.rugs > 1 ? 's' : ''} probable${kSrc.rugs > 1 ? 's' : ''}`); }
  if (!sig.length) sig.push({ level: 'info', text: o ? 'Rien de suspect trouvé' : 'Aucun signal sur le marché, analyse on-chain non faite', pts: 0 });

  t.score = Math.min(100, s);
  t.signals = sig.sort((a, b) => b.pts - a.pts);
  t.verdict = dead ? 'rug' : t.score >= 45 ? 'high' : t.score >= 20 ? 'medium' : 'low';
}
