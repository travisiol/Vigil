/**
 * Chasse aux ruggers : on lit les tokens pump.fun créés sur une fenêtre (toutes catégories : nouveaux, proches de la
 * migration, déjà migrés), on garde ceux qui ont eu du volume, un seul token par dev, les plus « rugger » d'abord.
 * Chaque dev est tracé ; s'il est trackable, on calcule la rentabilité sur ses 10 derniers tokens (les siens et ceux
 * de ses autres devs). On continue, fenêtre après fenêtre, jusqu'à avoir le nombre de ruggers rentables et trackables
 * demandé, et chaque rugger retenu s'affiche dès qu'il est trouvé.
 */
import { progressOf } from './scanner.js';

const MINT_AUTH = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'; // signe chaque création pump.fun
const WSOL = 'So11111111111111111111111111111111111111112';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const HUNT_DEFAULTS = { target: 3, hours: 3, maxHours: 3, maxAnalyse: 60, minVolume: 15000 };

/** Créations pump.fun sur la période : { mint, name, symbol, creator, createdAt }. */
export async function creations(rpc, since, now, log) {
  const out = new Map();
  const add = (t) => { if (t?.create && !out.has(t.create.mint)) out.set(t.create.mint, { mint: t.create.mint, name: t.create.name, symbol: t.create.symbol, creator: t.feePayer, createdAt: t.time }); };
  const w = await rpc.windowTxs(MINT_AUTH, since, now, 12000, 'desc').catch(() => null);
  if (w) { for (const t of w.txs) add(t); return { list: [...out.values()], partial: w.capped }; }
  // sans la lecture par fenêtre : les plus récentes, une par une
  log('Lecture des créations une par une (plus lent)');
  let before; const sigs = [];
  for (let i = 0; i < 8; i++) {
    const p = await rpc.sigsPage(MINT_AUTH, before, 1000);
    sigs.push(...p.filter((s) => !s.err && (s.blockTime ?? 0) >= since));
    if (p.length < 1000 || (p[p.length - 1].blockTime ?? 0) < since) break;
    before = p[p.length - 1].signature;
  }
  const pick = sigs.slice(0, 1500);
  for (let i = 0; i < pick.length; i += 25) {
    (await Promise.all(pick.slice(i, i + 25).map((s) => rpc.tx(s.signature).catch(() => null)))).forEach(add);
    if (i % 250 === 0) log(`Créations lues : ${Math.min(i + 25, pick.length)} / ${pick.length}`);
  }
  return { list: [...out.values()], partial: sigs.length > pick.length };
}

/** Marché DexScreener par lots de 30 (paires cotées en SOL). */
export async function markets(mints, log) {
  const out = new Map();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    let pairs = [];
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`, { signal: AbortSignal.timeout(15000) });
        if (r.status === 429) { await sleep(2000); continue; }
        pairs = r.ok ? await r.json() : [];
        break;
      } catch { await sleep(500); }
    }
    for (const p of Array.isArray(pairs) ? pairs : []) {
      if (p.quoteToken?.address !== WSOL) continue;
      const m = p.baseToken?.address;
      const e = out.get(m) || { pairs: [] };
      e.pairs.push(p);
      out.set(m, e);
    }
    if ((i / 30) % 40 === 0 && i) log(`Marché : ${Math.min(i + 30, mints.length)} / ${mints.length} tokens`);
    await sleep(210); // ~ 280 appels par minute au plus
  }
  for (const [mint, e] of out) {
    const amm = e.pairs.filter((p) => p.dexId !== 'pumpfun').sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const p = amm || e.pairs[0];
    const vol = e.pairs.reduce((s, x) => s + (x.volume?.h24 ?? 0), 0);
    const priceSol = Number(p.priceNative) || null;
    const progress = amm ? 1 : progressOf(priceSol);
    out.set(mint, { volume: vol, marketCap: p.marketCap ?? p.fdv ?? null, migrated: !!amm, progress, change1h: p.priceChange?.h1 ?? null });
  }
  return out;
}

/**
 * Nombre de tokens créés par cette adresse (au moins celui de la période). Plus de 1 000 transactions = il lance en série.
 * On relit ses 60 dernières transactions réussies (en cache la plupart du temps).
 */
export async function createsOf(rpc, creator, mint) {
  const seen = new Set([mint]);
  const sigs = await rpc.sigsPage(creator, undefined, 1000).catch(() => []);
  if (sigs.length >= 1000) return 2;
  const ok = sigs.filter((x) => !x.err).slice(0, 60);
  for (let i = 0; i < ok.length && seen.size < 2; i += 20) {
    const txs = await Promise.all(ok.slice(i, i + 20).map((x) => rpc.tx(x.signature).catch(() => null)));
    for (const t of txs) if (t?.create && t.signers.includes(creator)) seen.add(t.create.mint);
  }
  return seen.size;
}

/** Catégorie comme sur Axiom. */
export const category = (m) => (m.migrated ? 'migré' : m.progress != null && m.progress >= 0.7 ? 'final stretch' : 'nouveau');
/** Mort après du volume = rug (le prix est revenu près du départ, ou −70 % sur l'heure). */
export const isRug = (m) => !m.migrated && ((m.progress != null && m.progress < 0.05) || (m.change1h != null && m.change1h <= -70));

export const MIN_SOL_PER_LAUNCH = 0.1;
/** Nos critères : trackable (réglage F Project durable), actif sur 24 h, au moins 5 tokens rejoués, et rentable. */
export function judge(s) {
  if (s.notDev || s.verdict !== 'track') return 'notTrackable';
  if (s.inactive) return 'inactive';
  if ((s.n || 0) < 5) return 'thin';
  // règle du user : au moins 1 SOL pour 10 lancements (0,1 SOL par lancement rejoué)
  if (!(s.bestPnl >= MIN_SOL_PER_LAUNCH * (s.n || 0))) return 'notProfitable';
  return 'keep';
}

/** Les devs d'une fenêtre, un seul token créé sur la période, les plus « rugger » d'abord. */
async function candidatesIn(rpc, from, to, opts, log, stats) {
  const cr = await creations(rpc, from, to, log);
  stats.created += cr.list.length;
  log(`${cr.list.length} tokens créés${cr.partial ? ' (lecture partielle)' : ''} : lecture du marché`);
  const mk = await markets(cr.list.map((t) => t.mint), log);
  const devs = new Map();
  for (const t of cr.list) {
    const m = mk.get(t.mint);
    if (!m || m.volume < opts.minVolume) continue;
    const d = devs.get(t.creator) || { creator: t.creator, tokens: [], volume: 0, rugs: 0, created: 0 };
    d.tokens.push({ ...t, ...m, category: category(m), rug: isRug(m) });
    d.volume += m.volume; d.rugs += isRug(m) ? 1 : 0;
    devs.set(t.creator, d);
  }
  for (const t of cr.list) { const d = devs.get(t.creator); if (d) d.created++; }
  const single = [...devs.values()].filter((d) => d.created === 1);
  stats.multi += devs.size - single.length;
  stats.devs += devs.size;
  for (const d of devs.values()) for (const t of d.tokens) stats.categories[t.category] = (stats.categories[t.category] || 0) + 1;
  // du plus récent au plus ancien (demande du user) : un rugger qui vient de lancer est celui qu'on peut encore suivre
  return single.map((d) => ({ ...d, lastAt: Math.max(...d.tokens.map((t) => t.createdAt || 0)) })).sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * Cherche des ruggers jusqu'à en trouver `target` qui passent nos critères (trackable, actif, rentable).
 * Chaque rugger retenu est envoyé tout de suite. Si une fenêtre est épuisée, on lit la fenêtre d'avant (jusqu'à maxHours).
 * @param deps.traceDev, deps.qualifyInv, deps.recent, deps.qualified, deps.summarize, deps.shouldStop, deps.save
 */
export async function hunt(rpc, optsIn, emit, deps) {
  const opts = { ...HUNT_DEFAULTS, ...optsIn };
  opts.maxHours = opts.hours; // une seule fenêtre : on ne remonte jamais au-delà des X dernières heures
  const log = (msg) => emit({ type: 'log', msg });
  const stats = { target: opts.target, analysed: 0, created: 0, devs: 0, multi: 0, categories: {}, hours: 0, rejected: { notTrackable: 0, notProfitable: 0, inactive: 0, thin: 0, error: 0 } };
  const rows = [];
  const snapshot = (done = false) => ({ createdAt: Date.now(), options: opts, stats: { ...stats, rejected: { ...stats.rejected } }, rows: [...rows], done });
  const push = () => { emit({ type: 'hunt', rows: [...rows], stats: snapshot().stats }); deps.save?.(snapshot()); };
  const seen = new Set();
  let to = Math.floor(Date.now() / 1000);
  let stopReason = null;
  while (rows.length < opts.target) {
    if (deps.shouldStop?.()) { stopReason = 'arrêtée'; break; }
    if (stats.hours >= opts.maxHours) { stopReason = `plus de candidats dans les ${opts.maxHours} dernières heures`; break; }
    if (stats.analysed >= opts.maxAnalyse) { stopReason = `${opts.maxAnalyse} ruggers analysés`; break; }
    const from = to - opts.hours * 3600;
    log(`Créations pump.fun de ${stats.hours ? `${stats.hours} h à ${stats.hours + opts.hours} h` : `${opts.hours} dernières heures`}`);
    const list = await candidatesIn(rpc, from, to, opts, log, stats);
    stats.hours += opts.hours; to = from;
    push();
    for (const d of list) {
      if (rows.length >= opts.target || deps.shouldStop?.() || stats.analysed >= opts.maxAnalyse) break;
      if (seen.has(d.creator)) continue;
      seen.add(d.creator);
      // un dev qui a déjà créé un autre token avant (même adresse) est écarté
      if ((await createsOf(rpc, d.creator, d.tokens[0].mint)) >= 2) { stats.multi++; continue; }
      const top = [...d.tokens].sort((a, b) => b.volume - a.volume)[0];
      stats.analysed++;
      const tag = `Rugger ${stats.analysed} (${rows.length} / ${opts.target} retenus)`;
      try {
        log(`${tag} : traque de ${d.creator.slice(0, 4)}…${d.creator.slice(-4)} (${top.symbol || top.mint.slice(0, 6)})`);
        let inv = deps.recent(d.creator);
        if (!inv) inv = await deps.traceDev(d.creator, (e) => { if (e.type === 'log') emit({ type: 'sub', msg: e.msg }); });
        let s = deps.summarize(inv);
        // inutile de calculer la rentabilité d'un dev qu'on ne peut pas tracker
        if (judge({ ...s, n: 99, bestPnl: 1 }) === 'keep' && !deps.qualified(inv)) {
          log(`${tag} : trackable, rentabilité sur ses 10 derniers tokens`);
          inv.qualification = await deps.qualifyInv(inv, (e) => { if (e.type === 'log') emit({ type: 'sub', msg: e.msg }); });
          s = deps.summarize(inv);
        }
        const verdict = judge(s);
        if (verdict === 'keep') {
          rows.push({ creator: d.creator, symbol: top.symbol, mint: top.mint, category: top.category, volume: d.volume, rugs: d.rugs, created: d.created, status: 'done', ...s });
          log(`Rugger retenu : ${d.creator.slice(0, 4)}…${d.creator.slice(-4)} (${rows.length} / ${opts.target})`);
        } else stats.rejected[verdict]++;
      } catch (e) {
        stats.rejected.error++;
      }
      push();
    }
  }
  rows.sort((a, b) => (b.bestPnl ?? -1e9) - (a.bestPnl ?? -1e9));
  const result = { ...snapshot(true), stopReason: rows.length >= opts.target ? null : stopReason || 'plus de candidats' };
  return result;
}
