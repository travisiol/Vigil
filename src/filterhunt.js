/**
 * Chasse aux ruggers par filtres (17/11/2026) : au lieu de tracer chaque dev (trop long), on filtre les tokens
 * pump.fun des dernières heures selon les critères du user, et on lui sort ceux qui collent. Il trace ensuite le dev
 * qui l'intéresse.
 *
 * Deux étapes pour aller vite :
 * 1. critères « marché » (gratuits) : volume, market cap actuelle, migré ou pas ;
 * 2. critères « courbe » (lecture des trades, seulement pour ceux qui passent l'étape 1) : market cap à la 1re bougie,
 *    % atteint depuis la 1re bougie, plus haut, le rug (−X % en moins de Y s), temps avant le rug, bundle ;
 *    et enfin « dev à un seul token ».
 */
import { creations, markets } from './hunt.js';
import { curveTrades } from './qualify.js';
import { earlyBuyersFrom } from './snipers.js';
import { devSource } from './devsource.js';

const SUPPLY = 1e9;
const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Critères acceptés (tous optionnels, null = pas de filtre). Montants en $, pourcentages en %, durées en secondes. */
export function normalizeFilters(f = {}) {
  return {
    hours: Math.max(1, Math.min(12, n(f.hours) ?? 3)),
    minVolume: n(f.minVolume), maxVolume: n(f.maxVolume),
    minMcNow: n(f.minMcNow), maxMcNow: n(f.maxMcNow),
    minAthUsd: n(f.minAthUsd), maxAthUsd: n(f.maxAthUsd),
    maxEntryUsd: n(f.maxEntryUsd),
    minPeakPct: n(f.minPeakPct),
    minRugDrop: n(f.minRugDrop), rugWithinSec: n(f.rugWithinSec) ?? 60,
    minRugAfterSec: n(f.minRugAfterSec), maxRugAfterSec: n(f.maxRugAfterSec),
    minBundle: n(f.minBundle), maxBundle: n(f.maxBundle),
    minBundlePct: n(f.minBundlePct), maxBundlePct: n(f.maxBundlePct),
    migrated: ['yes', 'no'].includes(f.migrated) ? f.migrated : 'any',
    singleDev: f.singleDev !== false,
    analyse: f.analyse !== false, // analyse complète (traque + rentabilité) de chaque token trouvé, après la recherche
    sourceOk: f.sourceOk === true, // ne garder que les devs dont la source est traquable (vert ou jaune)
    max: Math.max(1, Math.min(200, n(f.max) ?? 50)),
  };
}

/** Règles du user : 5 tokens analysés au minimum, et 1 SOL pour 10 lancements (0,1 SOL par lancement). */
export const RANK_MIN_TOKENS = 5;
export const RANK_MIN_SOL_PER_LAUNCH = 0.1;

/**
 * Rang d'un token analysé, du meilleur (0) au pire : d'abord ce qui est à tracker et rentable, ensuite ce qui est
 * traquable mais à confirmer, puis à creuser, trop tard, perdu ; les analyses pas finies en dernier.
 */
export function rankTier(a) {
  if (!a || a.status === 'waiting' || a.status === 'running') return 9;
  if (a.status === 'error' || a.status === 'skipped') return 8;
  if (a.notDev || a.verdict === 'reject' || a.verdict === 'lost') return 7;
  if (a.inactive) return 6;
  if (a.verdict === 'late') return 5;
  const enough = a.n >= RANK_MIN_TOKENS;
  const profit = enough && a.bestPnl >= RANK_MIN_SOL_PER_LAUNCH * a.n;
  if (a.verdict === 'track') {
    if (profit) return 0;
    if (enough && a.bestPnl > 0) return 1;
    if (!enough) return 2;
    return 4;
  }
  return 3; // à creuser / à surveiller
}
const perToken = (a) => (a?.n ? (a.bestPnl ?? 0) / a.n : -Infinity);
// À niveau égal, les devs financés par un exchange passent devant (schéma prioritaire du user, le plus fiable à tracker).
export function rankRows(rows) {
  return rows
    .map((r, i) => ({ r, i, tier: rankTier(r.analysis) }))
    .sort((x, y) => x.tier - y.tier || (x.tier < 6 ? !!y.r.analysis?.exchange - !!x.r.analysis?.exchange : 0) || (x.tier < 8 ? perToken(y.r.analysis) - perToken(x.r.analysis) || (y.r.analysis?.n || 0) - (x.r.analysis?.n || 0) : 0) || x.i - y.i)
    .map((x) => x.r);
}

/**
 * Regroupe les résultats d'une même équipe : même tracker, même source partagée (mère, exchange + montant exact),
 * ou le dev de l'un apparaît dans la chaîne de l'autre. Le mieux classé devient la carte de l'équipe ; les autres
 * passent dessous (teamLead = son CA). Les lignes doivent déjà être classées.
 */
export function groupTeams(rows) {
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const done = rows.map((r) => (r.analysis?.status === 'done' ? r.analysis : null));
  const byKey = new Map();
  done.forEach((a, i) => {
    if (!a) return;
    for (const k of a.teamKeys || []) { if (byKey.has(k)) union(byKey.get(k), i); else byKey.set(k, i); }
    const mem = new Set(a.members || []);
    rows.forEach((o, j) => { if (j !== i && o.creator && mem.has(o.creator)) union(i, j); });
  });
  for (const r of rows) { delete r.teamLead; delete r.team; }
  rows.forEach((r, i) => {
    const lead = find(i);
    if (lead === i) return;
    r.teamLead = rows[lead].mint;
    (rows[lead].team ||= []).push({ mint: r.mint, symbol: r.symbol, name: r.name, createdAt: r.createdAt, analysisId: r.analysis?.id || null });
  });
  return rows;
}

const inRange = (v, lo, hi) => (lo == null || (v != null && v >= lo)) && (hi == null || (v != null && v <= hi));

/** Le rug : la plus forte chute (depuis un point haut) en moins de `sec` secondes, et quand elle commence. */
export function biggestDrop(points, sec) {
  let best = { drop: 0, at: null };
  for (let i = 0; i < points.length; i++) {
    let lo = points[i].mc;
    for (let j = i + 1; j < points.length && points[j].t - points[i].t <= sec; j++) lo = Math.min(lo, points[j].mc);
    const d = points[i].mc > 0 ? (points[i].mc - lo) / points[i].mc : 0;
    if (d > best.drop) best = { drop: d, at: points[i].t };
  }
  return best;
}

/** Les chiffres « courbe » d'un token, en $ (solUsd) : 1re bougie, plus haut, % atteint, rug. */
export function curveFacts(ct, solUsd, rugWithinSec = 60) {
  const pts = ct.points;
  const first = pts.filter((p) => p.t <= ct.t0);
  const entry = (first.length ? first[first.length - 1] : pts[0]).mc;
  const after = pts.filter((p) => p.t > ct.t0);
  const peak = after.length ? Math.max(...after.map((p) => p.mc)) : entry;
  const rug = biggestDrop(pts, rugWithinSec);
  return {
    entryUsd: entry * solUsd, athUsd: peak * solUsd, peakPct: (peak / entry - 1) * 100,
    rugDropPct: rug.drop * 100, rugAfterSec: rug.at != null ? rug.at - ct.t0 : null, migrated: ct.migrated, trades: pts.length,
  };
}

/** Le token passe-t-il les critères « courbe » ? Renvoie la première raison de rejet, ou null. */
export function failCurve(fx, f) {
  if (!inRange(fx.entryUsd, null, f.maxEntryUsd)) return 'market cap à la 1re bougie trop haute';
  if (!inRange(fx.peakPct, f.minPeakPct, null)) return '% depuis la 1re bougie trop bas';
  if (!inRange(fx.athUsd, f.minAthUsd, f.maxAthUsd)) return 'plus haut hors de la fourchette';
  if (!inRange(fx.rugDropPct, f.minRugDrop, null)) return 'pas de rug assez fort';
  if ((f.minRugAfterSec != null || f.maxRugAfterSec != null) && !inRange(fx.rugAfterSec, f.minRugAfterSec, f.maxRugAfterSec)) return 'rug trop tôt ou trop tard';
  return null;
}

/**
 * @param deps.shouldStop(), deps.save(snapshot), deps.solUsd, deps.createsOf(rpc, creator, mint) → nombre de tokens du dev
 */
export async function filterHunt(rpc, filtersIn, emit, deps = {}) {
  const f = normalizeFilters(filtersIn);
  const log = (msg) => emit({ type: 'log', msg });
  const now = Math.floor(Date.now() / 1000);
  const solUsd = deps.solUsd || 75;
  const stats = { created: 0, market: 0, curve: 0, matched: 0, rejected: {} };
  const rows = [];
  const reject = (why) => { stats.rejected[why] = (stats.rejected[why] || 0) + 1; };
  const snapshot = (done = false, stopReason = null) => ({ createdAt: Date.now(), filters: f, stats: { ...stats, rejected: { ...stats.rejected } }, rows: [...rows], done, stopReason, rules: 'filter-hunt-v1' });
  const push = () => { emit({ type: 'hunt', rows: [...rows], stats: snapshot().stats }); deps.save?.(snapshot()); };

  log(`Créations pump.fun des ${f.hours} dernières heures`);
  const cr = await creations(rpc, now - f.hours * 3600, now, log);
  stats.created = cr.list.length;
  log(`${cr.list.length} tokens créés : lecture du marché`);
  const mk = await markets(cr.list.map((t) => t.mint), log);
  // 1. critères marché
  const pass1 = [];
  for (const t of cr.list) {
    const m = mk.get(t.mint);
    if (!m) { reject('pas de marché'); continue; }
    const mcUsd = m.marketCap ?? null;
    if (!inRange(m.volume, f.minVolume, f.maxVolume)) { reject('volume'); continue; }
    if (!inRange(mcUsd, f.minMcNow, f.maxMcNow)) { reject('market cap actuelle'); continue; }
    if (f.migrated === 'yes' && !m.migrated) { reject('pas migré'); continue; }
    if (f.migrated === 'no' && m.migrated) { reject('migré'); continue; }
    pass1.push({ ...t, volume: m.volume, mcNow: mcUsd, migratedNow: m.migrated });
  }
  stats.market = pass1.length;
  pass1.sort((a, b) => b.createdAt - a.createdAt);
  log(`${pass1.length} tokens passent le volume et la market cap : lecture de leurs trades`);
  push();
  // 2. critères courbe, bundle, dev
  let i = 0; let stopReason = null;
  for (const t of pass1) {
    if (deps.shouldStop?.()) { stopReason = 'arrêtée'; break; }
    if (rows.length >= f.max) { stopReason = `${f.max} résultats`; break; }
    i++;
    if (i % 10 === 0) log(`Trades lus : ${i} / ${pass1.length} (${rows.length} trouvés)`);
    const ct = await curveTrades(rpc, t.mint, t.createdAt, { full: true, windowSec: 1800, cap: 2000 }).catch(() => null);
    if (!ct?.points?.length) { reject('trades illisibles'); continue; }
    stats.curve++;
    const fx = curveFacts(ct, solUsd, f.rugWithinSec);
    const why = failCurve(fx, f);
    if (why) { reject(why); continue; }
    // bundle : les achats dans le même bloc que la création
    const early = await rpc.windowTxs(t.mint, t.createdAt - 2, t.createdAt + 5, 120, 'asc').catch(() => null);
    let bundle = null; let bundlePct = null;
    if (early) {
      const eb = earlyBuyersFrom(early.txs, t.mint, t.creator, { first: 40 });
      const inB = eb.buyers.filter((b) => b.bundle);
      bundle = inB.length;
      const set = new Set(inB.map((b) => b.wallet));
      const got = early.txs.flatMap((x) => x.tokenDelta).filter((d) => d.mint === t.mint && d.delta > 0 && set.has(d.owner)).reduce((s, d) => s + d.delta, 0);
      bundlePct = (got / SUPPLY) * 100;
    }
    if (!inRange(bundle, f.minBundle, f.maxBundle)) { reject('taille du bundle'); continue; }
    if (!inRange(bundlePct, f.minBundlePct, f.maxBundlePct)) { reject('% de supply du bundle'); continue; }
    let devTokens = null;
    if (f.singleDev && deps.createsOf) {
      devTokens = await deps.createsOf(rpc, t.creator, t.mint).catch(() => null);
      if (devTokens != null && devTokens >= 2) { reject('dev à plusieurs tokens'); continue; }
    }
    // la source du dev : qui lui a envoyé son SOL, et est-ce traquable ?
    const source = await devSource(rpc, t.creator, t.createdAt).catch(() => ({ color: 'red', kind: 'unknown', text: 'Source illisible' }));
    if (f.sourceOk && source.color === 'red') { reject('source pas traquable'); continue; }
    rows.push({ mint: t.mint, symbol: t.symbol, name: t.name, creator: t.creator, createdAt: t.createdAt, volume: t.volume, mcNow: t.mcNow, ...fx, bundle, bundlePct, devTokens, source });
    stats.matched = rows.length;
    log(`Trouvé : ${t.symbol || t.mint.slice(0, 6)} (${rows.length})`);
    push();
  }
  // 3. analyse de chaque token trouvé, l'un après l'autre : traque complète du dev + rentabilité (sauf source rouge)
  if (f.analyse && deps.analyse && !stopReason?.startsWith('arrêtée')) {
    for (const r of rows) r.analysis = r.source?.color === 'red' ? { status: 'skipped' } : { status: 'waiting' };
    push();
    const todo = rows.filter((r) => r.analysis.status === 'waiting');
    let k = 0;
    for (const r of todo) {
      if (deps.shouldStop?.()) { stopReason = 'arrêtée pendant les analyses'; break; }
      k++;
      log(`Analyse ${k} / ${todo.length} : ${r.symbol || r.mint.slice(0, 6)} (traque du dev et rentabilité)`);
      r.analysis = { status: 'running' };
      push();
      try { r.analysis = { status: 'done', ...(await deps.analyse(r.creator, (e) => { if (e.type === 'log') emit({ type: 'sub', msg: e.msg }); })) }; } catch (e) { r.analysis = { status: 'error', error: e.message || String(e) }; }
      // classement du meilleur au pire, mis à jour après chaque analyse
      rows.splice(0, rows.length, ...groupTeams(rankRows(rows)));
      push();
    }
  }
  return snapshot(true, stopReason || null);
}
