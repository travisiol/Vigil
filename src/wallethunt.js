/**
 * Chasse aux wallets (page Wallet tracker) : les wallets du rug, pas le dev.
 * Règles du user (17/11/2026) :
 * - un rug, c'est −70 % en quelques secondes (ou en moins d'une minute pour les rugs plus lents), pas « sur l'heure » ;
 * - sur un rug : la 1re transaction est le dev ; on prend tous les wallets du bundle (même bloc que la création)
 *   et les 3 ou 4 premiers acheteurs juste après le dev, pas plus ;
 * - un wallet utile fait entre 3 et 30 trades par jour ;
 * - ensuite on regarde seulement ses trades (heures d'avant et heure d'après le rug) : touche-t-il +100 %,
 *   en entrant sous 10 000 $ de market cap ? Et son PnL sur 30 jours.
 */
import { creations, markets, category } from './hunt.js';
import { curveTrades } from './qualify.js';
import { earlyBuyersFrom, fastDrop, recentBuysFrom } from './snipers.js';
import { analyseCopyWallet, trackerVerdict, TRACKER_RULES } from './wallettracker.js';

export const WALLET_HUNT_DEFAULTS = { target: 3, hours: 3, minVolume: 15000, maxWallets: 40, firstBuyers: 4, maxBundle: 10, rugDrop: 0.7 };

/** Rug : le prix perd au moins 70 % en 10 secondes, ou en moins d'une minute (rug plus lent). */
export function isRugFast(points, drop = 0.7) {
  return fastDrop(points, 10) >= drop || fastDrop(points, 60) >= drop;
}

/** Même groupe (« ring ») : deux wallets qui ont acheté en grande partie les mêmes coins. On n'en copie qu'un. */
export function sameRing(a, b) {
  const A = new Set(a || []); const B = new Set(b || []);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const m of A) if (B.has(m)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.5;
}

/** Les wallets à regarder sur un rug : tout le bundle (même bloc que la création) + les 3-4 premiers après le dev. */
export function rugWallets(buyers, { firstBuyers = 4, maxBundle = 10 } = {}) {
  const bundle = buyers.filter((b) => b.bundle).slice(0, maxBundle);
  const first = buyers.slice(0, firstBuyers);
  const out = [];
  for (const b of [...bundle, ...first]) if (!out.some((x) => x.wallet === b.wallet)) out.push(b);
  return out;
}

/**
 * @param deps.shouldStop(), deps.save(snapshot), deps.saveWallet(c), deps.recentWallet(address), deps.solUsd
 */
export async function walletHunt(rpc, optsIn, emit, deps = {}) {
  const o = { ...WALLET_HUNT_DEFAULTS, ...optsIn };
  const log = (msg) => emit({ type: 'log', msg });
  const now = Math.floor(Date.now() / 1000);
  const stats = { target: o.target, coins: 0, coinsLooked: 0, rugs: 0, wallets: 0, rejected: { notProfitable: 0, thin: 0, tooActive: 0, tooQuiet: 0, dev: 0, ring: 0, error: 0 } };
  const rows = [];
  const snapshot = (done = false, stopReason = null) => ({ createdAt: Date.now(), options: o, stats: { ...stats, rejected: { ...stats.rejected } }, rows: [...rows], done, stopReason, rules: 'wallet-hunt-v2' });
  const push = () => { emit({ type: 'hunt', rows: [...rows], stats: snapshot().stats }); deps.save?.(snapshot()); };

  // 1. les coins avec du volume, du plus récent au plus ancien ; le rug est vérifié sur la courbe, coin par coin
  log(`Créations pump.fun des ${o.hours} dernières heures`);
  const cr = await creations(rpc, now - o.hours * 3600, now, log);
  log(`${cr.list.length} tokens créés : lecture du marché`);
  const mk = await markets(cr.list.map((t) => t.mint), log);
  const coins = cr.list.map((t) => ({ ...t, m: mk.get(t.mint) })).filter((t) => t.m && t.m.volume >= o.minVolume).sort((a, b) => b.createdAt - a.createdAt);
  stats.coins = coins.length;
  log(`${coins.length} coins avec du volume : recherche des rugs (−70 % en quelques secondes ou en 1 minute)`);
  push();

  const seen = new Set();
  let stopReason = null;
  for (const coin of coins) {
    if (rows.length >= o.target) break;
    if (deps.shouldStop?.()) { stopReason = 'arrêtée'; break; }
    if (stats.wallets >= o.maxWallets) { stopReason = `${o.maxWallets} wallets analysés`; break; }
    stats.coinsLooked++;
    const ct = await curveTrades(rpc, coin.mint, coin.createdAt, { full: true, windowSec: 3600 }).catch(() => null);
    if (!ct || !isRugFast(ct.points, o.rugDrop)) continue;
    stats.rugs++;
    // 2. le bundle et les 3-4 premiers acheteurs après le dev
    const r = await rpc.windowTxs(coin.mint, coin.createdAt - 2, coin.createdAt + 20, 200, 'asc').catch(() => null);
    if (!r) continue;
    const eb = earlyBuyersFrom(r.txs, coin.mint, coin.creator, { first: 30 });
    const picks = rugWallets(eb.buyers, o);
    log(`Rug ${stats.rugs} : ${coin.symbol || coin.mint.slice(0, 6)}, ${picks.filter((b) => b.bundle).length} wallets dans le bundle, ${picks.length} à regarder`);
    for (const b of picks) {
      if (rows.length >= o.target || deps.shouldStop?.() || stats.wallets >= o.maxWallets) break;
      if (seen.has(b.wallet)) continue;
      seen.add(b.wallet);
      const role = b.bundle ? 'bundle' : `${b.rank === 1 ? '1er' : `${b.rank}e`} acheteur après le dev`;
      const where = `${coin.symbol || coin.mint.slice(0, 6)} (${role})`;
      // 3. entre 3 et 30 trades par jour
      const day = await rpc.windowTxs(b.wallet, now - 86400, now, 1000, 'desc').catch(() => null);
      const perDay = day ? (day.capped ? Infinity : recentBuysFrom(day.txs, b.wallet, { max: 1000 }).total) : null;
      if (perDay != null && perDay > TRACKER_RULES.maxPerDay) { stats.rejected.tooActive++; log(`${b.wallet.slice(0, 4)}… (${where}) : ${Number.isFinite(perDay) ? perDay : 'plus de 300'} trades sur 24 h, ignoré`); continue; }
      if (perDay != null && perDay < TRACKER_RULES.minPerDay) { stats.rejected.tooQuiet++; log(`${b.wallet.slice(0, 4)}… (${where}) : ${perDay} trade${perDay > 1 ? 's' : ''} sur 24 h, ignoré`); continue; }
      stats.wallets++;
      log(`Wallet ${stats.wallets} (${rows.length} / ${o.target} retenus) : ${b.wallet.slice(0, 4)}…${b.wallet.slice(-4)}, ${where}`);
      // 4. ses trades autour du rug (heures d'avant, heure d'après) et son PnL sur 30 jours
      let c = deps.recentWallet?.(b.wallet);
      if (!c) {
        c = await analyseCopyWallet(rpc, b.wallet, { solUsd: deps.solUsd, around: coin.createdAt, emit: (e) => { if (e.type === 'log') emit({ type: 'sub', msg: e.msg }); } });
        c.foundOn = { mint: coin.mint, symbol: coin.symbol, role };
        deps.saveWallet?.(c);
      }
      const v = trackerVerdict(c);
      let verdict = v.good ? 'keep' : c.error ? 'error' : c.creates ? 'dev' : (c.counted || 0) < TRACKER_RULES.minCounted ? 'thin' : 'notProfitable';
      if (verdict === 'keep' && rows.some((x) => sameRing(x.mints, c.copies.map((y) => y.mint)))) verdict = 'ring';
      if (verdict === 'keep') {
        rows.push({ wallet: b.wallet, coin: { mint: coin.mint, symbol: coin.symbol, category: category(coin.m) }, role, hits: c.hits, counted: c.counted, pnl100: c.pnl100, pnl30: c.pnl30, buys24h: c.buys24h, entryMedianUsd: c.entryMedianUsd, type: c.style?.type || null, mints: c.copies.map((y) => y.mint) });
        log(`Wallet retenu : ${b.wallet.slice(0, 4)}…${b.wallet.slice(-4)} (${rows.length} / ${o.target})`);
      } else stats.rejected[verdict] = (stats.rejected[verdict] || 0) + 1;
      push();
    }
  }
  rows.sort((a, b) => b.pnl100 - a.pnl100);
  return snapshot(true, rows.length >= o.target ? null : stopReason || 'plus de coins rug sur la période');
}
