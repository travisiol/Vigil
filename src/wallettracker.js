/**
 * Wallet tracker : un wallet à copier (pas un dev). On ne regarde PAS de schéma de financement ici :
 * seulement ses trades, rejoués comme le bot du user les copierait.
 *
 * Règles du user (17/11/2026) :
 * - on vend tout à +100 % : un achat compte s'il touche +100 % depuis l'entrée ;
 * - l'entrée doit être tôt dans le coin : un achat au-dessus de 10 000 $ de market cap ne compte pas
 *   (pas besoin d'être en 1re bougie) ;
 * - un wallet utile fait entre 3 et 30 trades par jour ;
 * - son PnL sur 30 jours positif est un bon signe ;
 * - achats rejoués : les 3 jours avant le rug et l'heure d'après (30 au plus) ;
 * - rentable pour le user : au moins 1 SOL pour 10 achats copiés (mise 0,15 SOL, frais compris).
 */
import { curveTrades } from './qualify.js';
import { recentBuysFrom, copyTrade, walletStyle } from './snipers.js';
import { tradesFrom } from './realpnl.js';

export const TRACKER_RULES = { maxEntryUsd: 10000, minPerDay: 3, maxPerDay: 30, minCounted: 5, buySol: 0.15, fees: 0.038, minSolPerTrade: 0.1, maxAgeSec: 900, maxBuys: 30 };

/** Verdict : bon à copier pour le user ? */
export function trackerVerdict(c, r = TRACKER_RULES) {
  const why = [];
  if (c.error) why.push(c.error);
  if (c.creates) why.push('il crée des tokens : c’est un dev, à tracker avec la Traque');
  if (c.buys24h != null && c.buys24h > r.maxPerDay) why.push(`${Number.isFinite(c.buys24h) ? c.buys24h : 'plus de 300'} trades sur 24 h (30 au plus)`);
  if (c.buys24h != null && c.buys24h < r.minPerDay) why.push(`${c.buys24h} trade${c.buys24h > 1 ? 's' : ''} sur 24 h : trop peu pour être utile`);
  if ((c.counted || 0) < r.minCounted) why.push(`seulement ${c.counted || 0} achat${(c.counted || 0) > 1 ? 's' : ''} tôt (sous 10 000 $) à rejouer, il en faut ${r.minCounted}`);
  else if (!(c.pnl100 >= r.minSolPerTrade * c.counted)) why.push(c.pnl100 > 0 ? `+100 % touché sur ${c.hits}/${c.counted} achats : ${c.pnl100.toFixed(2)} SOL pour toi, moins de 1 SOL pour 10` : `+100 % touché sur seulement ${c.hits}/${c.counted} achats : tu perdrais en vendant à +100 %`);
  if (c.pnl30 && c.pnl30.closed >= 5 && c.pnl30.pnlSol <= 0) why.push('négatif sur 30 jours');
  return { good: !why.length, why };
}

/**
 * @param o.solUsd prix du SOL en $ (pour la market cap d'entrée) ; o.around temps (s) d'un événement (le rug où on l'a trouvé) :
 *        on rejoue en priorité ses achats des heures d'avant et de l'heure d'après
 */
export async function analyseCopyWallet(rpc, wallet, o = {}) {
  const r = { ...TRACKER_RULES, ...o };
  const emit = o.emit || (() => {});
  const log = (msg) => emit({ type: 'log', msg });
  const now = Math.floor(Date.now() / 1000);
  const c = { wallet, mode: 'tracker-v2', createdAt: Date.now() };
  log(`Trades de ${wallet.slice(0, 4)}…${wallet.slice(-4)} sur 30 jours`);
  const w = await rpc.windowTxs(wallet, now - 30 * 86400, now, 6000, 'desc').catch(() => null);
  if (!w) { c.error = 'lecture impossible'; c.verdict = trackerVerdict(c, r); return c; }
  const txs = w.txs;
  // activité sur 24 h
  const day = txs.filter((t) => t.time >= now - 86400);
  c.buys24h = recentBuysFrom(day, wallet, { max: 1000 }).total;
  c.creates = txs.filter((t) => t.create && t.signers?.includes(wallet)).length;
  // son PnL sur 30 jours (ses vrais achats et ventes, frais compris)
  const own = tradesFrom(txs, wallet).filter((t) => t.closed && t.spent > 0);
  const ts = txs.map((t) => t.time);
  c.pnl30 = { closed: own.length, wins: own.filter((t) => t.pnlSol > 0).length, pnlSol: own.reduce((x, t) => x + t.pnlSol, 0), days: ts.length ? (now - Math.min(...ts)) / 86400 : 0, partial: !!w.capped };
  c.ownHours = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 3600 : null;
  c.style = walletStyle(own, { ownHours: c.ownHours, copies: [], late: 0 });
  // achats à rejouer : les 3 jours avant l'événement (le rug où on l'a trouvé) et l'heure d'après ; sinon les 3 derniers jours.
  // 30 au plus, les plus proches de l'événement d'abord (un wallet à 3-30 trades par jour a besoin de plusieurs jours d'achats)
  const from = o.around ? o.around - 3 * 86400 : now - 3 * 86400;
  const to = o.around ? o.around + 3600 : now;
  const buys = recentBuysFrom(txs.filter((t) => t.time >= from && t.time <= to), wallet, { max: r.maxBuys }).buys;
  c.copies = [];
  let old = 0; let j = 0;
  for (const b of buys) {
    j++;
    if (j % 5 === 0) log(`Achats rejoués : ${j} / ${buys.length}`);
    const ct = await curveTrades(rpc, b.mint, b.time - r.maxAgeSec, { windowSec: 7200 + r.maxAgeSec, full: true, noCreateAfter: b.time }).catch(() => null);
    if (!ct) { old++; continue; } // token créé bien avant son achat : pas une entrée tôt
    const cp = copyTrade(ct, b.time);
    if (!cp) { old++; continue; }
    const entryUsd = o.solUsd ? cp.entryMcSol * o.solUsd : null;
    const s1 = cp.strategies.s1;
    c.copies.push({ mint: b.mint, time: b.time, delay: cp.delay, entryMcSol: cp.entryMcSol, entryUsd, hit100: s1.hits >= 1, pct100: s1.pct, counted: entryUsd == null || entryUsd <= r.maxEntryUsd, migrated: ct.migrated });
  }
  c.old = old;
  const counted = c.copies.filter((x) => x.counted);
  c.counted = counted.length;
  c.late = c.copies.length - counted.length; // entrés au-dessus de 10 000 $ : ne comptent pas
  c.hits = counted.filter((x) => x.hit100).length;
  c.pnl100 = counted.reduce((x, y) => x + (r.buySol * y.pct100) / 100 - r.fees, 0);
  c.entryMedianUsd = (() => { const a = counted.map((x) => x.entryUsd).filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; })();
  c.verdict = trackerVerdict(c, r);
  log(`${wallet.slice(0, 4)}… : +100 % sur ${c.hits}/${c.counted} achats tôt, ${c.pnl100 >= 0 ? '+' : ''}${c.pnl100.toFixed(2)} SOL pour toi, 30 jours ${c.pnl30.pnlSol >= 0 ? '+' : ''}${c.pnl30.pnlSol.toFixed(2)} SOL`);
  return c;
}
