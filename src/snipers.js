/**
 * Snipers à copier quand le dev n'est pas trackable (F Project « méthode 2 », copytrade).
 *
 * 1. Sur ses derniers tokens, on lit les toutes premières secondes et on note qui achète juste après le dev
 *    (bundle ou premiers acheteurs).
 * 2. Un wallet qui revient tôt sur plusieurs de ses tokens est soit dans son bundle, soit un sniper qui le suit.
 * 3. Pour chacun, on rejoue la copie de ses achats récents (tous tokens confondus, comme le ferait le bot) :
 *    entrée à la clôture de la bougie d'une seconde de son achat, puis les 3 façons de vendre du user.
 */
import { curveTrades, simulate, STRATEGIES, FEES_SOL, cappedPct, LOSS_CAP } from './qualify.js';
import { tradesFrom } from './realpnl.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const pctile = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null; };

/** Premiers acheteurs d'un token, dans l'ordre (le dev exclu). */
export function earlyBuyersFrom(txs, mint, dev, { first = 8 } = {}) {
  let curve = null; let t0 = null; let slot0 = null;
  const out = []; const seen = new Set();
  for (const t of txs) {
    if (!curve) {
      if (t.create?.mint !== mint) continue;
      const own = t.tokenDelta.filter((d) => d.mint === mint && d.delta > 0).sort((a, b) => b.delta - a.delta)[0];
      if (!own) continue;
      curve = own.owner; t0 = t.time; slot0 = t.slot ?? null;
      dev = dev || t.feePayer;
    }
    const c = t.tokenDelta.find((d) => d.mint === mint && d.owner === curve);
    if (!c || (c.delta >= 0 && !t.create)) continue; // pas un achat dans la courbe
    for (const d of t.tokenDelta) {
      if (d.mint !== mint || d.delta <= 0 || d.owner === curve || d.owner === dev || seen.has(d.owner)) continue;
      seen.add(d.owner);
      // bundle : même bloc que la création (à défaut du bloc, la même seconde)
      const bundle = slot0 != null && t.slot != null ? t.slot === slot0 : t.time === t0;
      out.push({ wallet: d.owner, rank: out.length + 1, delay: t.time - t0, slotDelta: slot0 != null && t.slot != null ? t.slot - slot0 : null, bundle, sig: t.sig });
      if (out.length >= first) return { t0, slot0, buyers: out };
    }
  }
  return { t0, slot0, buyers: out };
}

/** Wallets qui reviennent tôt sur plusieurs de ses tokens. */
export function rankEarlyWallets(perToken, { minTokens = 2, minShare = 0.3, top = 3 } = {}) {
  const n = perToken.length;
  const agg = new Map();
  for (const tk of perToken) {
    for (const b of tk.buyers) {
      if (b.rank > 5 && b.delay > 3) continue; // « juste après le dev » : 5 premiers ou dans les 3 secondes
      const e = agg.get(b.wallet) || { wallet: b.wallet, tokens: 0, ranks: [], delays: [] };
      e.tokens++; e.ranks.push(b.rank); e.delays.push(b.delay);
      agg.set(b.wallet, e);
    }
  }
  return [...agg.values()]
    .filter((e) => e.tokens >= minTokens && e.tokens / Math.max(1, n) >= minShare)
    .map((e) => ({ wallet: e.wallet, tokens: e.tokens, of: n, medianRank: median(e.ranks), medianDelay: median(e.delays) }))
    .sort((a, b) => b.tokens - a.tokens || a.medianRank - b.medianRank)
    .slice(0, top);
}

/** Ses achats récents dans des tokens (premier achat par token), du plus récent au plus ancien. */
export function recentBuysFrom(txs, wallet, { max = 12 } = {}) {
  const firstBuy = new Map();
  for (const t of txs) {
    if (!t.pump || t.create) continue;
    for (const d of t.tokenDelta) {
      if (d.owner !== wallet || d.delta <= 0 || d.mint === WSOL) continue;
      const fromPool = t.tokenDelta.some((x) => x.mint === d.mint && x.owner !== wallet && x.delta < 0);
      if (!fromPool) continue;
      const prev = firstBuy.get(d.mint);
      if (!prev || t.time < prev.time) firstBuy.set(d.mint, { mint: d.mint, time: t.time, sol: Math.max(0, -(t.solDelta[wallet] || 0)) / 1e9 });
    }
  }
  const all = [...firstBuy.values()].sort((a, b) => b.time - a.time);
  const times = all.map((b) => b.time);
  const spanH = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600 : 0;
  return { buys: all.slice(0, max), total: all.length, perHour: spanH > 0 ? all.length / spanH : null };
}

/** Le plus gros effondrement en une seule transaction (0 à 1). Au-delà de 0,35 : un gros porteur a vidé son sac, c'est un rug. */
export function maxSingleDrop(points) {
  let worst = 0;
  for (let i = 1; i < points.length; i++) if (points[i - 1].mc > 0) worst = Math.max(worst, (points[i - 1].mc - points[i].mc) / points[i - 1].mc);
  return worst;
}
export const RUG_DROP = 0.35;

/**
 * Chute la plus forte en moins de « sec » secondes (0 à 1). Un rug se fait souvent en plusieurs ventes rapprochées
 * (plusieurs wallets du dev) : aucune vente seule n'est énorme, mais le prix perd la moitié en moins d'une minute.
 */
export function fastDrop(points, sec = 60) {
  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    let lo = points[i].mc;
    for (let j = i + 1; j < points.length && points[j].t - points[i].t <= sec; j++) lo = Math.min(lo, points[j].mc);
    if (points[i].mc > 0) worst = Math.max(worst, (points[i].mc - lo) / points[i].mc);
  }
  return worst;
}
/** Coin de rugger : −45 % en moins d'une minute (ou une vente seule de −35 %), et pas de migration. */
export const isRugCurve = (points, migrated) => !migrated && (fastDrop(points, 60) >= 0.45 || maxSingleDrop(points) >= RUG_DROP);

/** Ventes en plus, pour le Wallet tracker : le user vise une sortie entre +100 % et +200 %. */
export const EXTRA_STRATEGIES = [
  { id: 't150', label: 'Tout à +150 %', levels: [[2.5, 1]] },
  { id: 't200', label: 'Tout à +200 %', levels: [[3, 1]] },
];

/** Copie d'un achat : entrée à la clôture de sa bougie d'une seconde, puis les 3 stratégies (et les ventes en plus). */
export function copyTrade(ct, buyTime) {
  if (!ct?.points?.length) return null;
  const upTo = ct.points.filter((p) => p.t <= buyTime);
  const after = ct.points.filter((p) => p.t > buyTime);
  if (!upTo.length || !after.length) return null;
  const entry = upTo[upTo.length - 1].mc;
  const strategies = Object.fromEntries([...STRATEGIES, ...EXTRA_STRATEGIES].map((st) => {
    const r = simulate(after, entry, st.levels, ct.migrated);
    return [st.id, { pct: r.pct, hits: r.hits, of: r.of, sold: r.sold, rest: r.rest, exit: r.exit }];
  }));
  return { delay: buyTime - ct.t0, entryMcSol: entry, strategies };
}

export function summarizeCopies(trades, buySol = 0.15, cap = LOSS_CAP) {
  const ok = trades.filter(Boolean);
  const strategies = STRATEGIES.map((st) => {
    const p = ok.map((t) => cappedPct(t.strategies[st.id], cap));
    return { id: st.id, label: st.label, pnlSol: p.reduce((x, v) => x + (buySol * v) / 100, 0) - ok.length * FEES_SOL, avgPct: p.length ? p.reduce((x, v) => x + v, 0) / p.length : 0, full: ok.filter((t) => t.strategies[st.id].hits === st.levels.length).length };
  });
  const best = strategies.reduce((b, x) => (x.pnlSol > b.pnlSol ? x : b), strategies[0]);
  const delays = ok.map((t) => t.delay);
  return {
    trades: ok.length, strategies, best: best.id, bestPnlSol: best.pnlSol,
    medianDelay: median(delays), sameSecond: ok.filter((t) => t.delay <= 0).length,
    ageFilterMin: delays.length ? Math.max(1, Math.ceil((pctile(delays, 0.9) + 1) / 60)) : 1,
  };
}

/**
 * @param result enquête (ses tokens + ceux de ses autres devs)
 * Candidats : les 3 premiers acheteurs du coin tracé (souvent les wallets du rugger), plus les wallets qui reviennent
 * tôt sur plusieurs de ses tokens. Pour chacun on vérifie : entre-t-il à la fin de la 1re bougie, fait-il du profit sur
 * la plupart de ses tokens, et le copier aurait-il rapporté (tes 3 façons de vendre).
 */
export async function findSnipers(result, rpc, emit = () => {}, { tokens = 10, top = 3, coinFirst = 3, bundleMax = 5, buys = 12, maxAgeSec = 120 } = {}) {
  const log = (msg) => emit({ type: 'log', msg });
  if (rpc?.provider !== 'helius') throw new Error('Il faut la clé Helius pour lire les premiers acheteurs.');
  const now = Math.floor(Date.now() / 1000);
  const all = [...result.tokens, ...(result.after || []).filter((t) => !t.groupBuy), ...(result.siblingTokens || [])]
    .filter((t) => t.mint && t.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((t, i, list) => list.findIndex((x) => x.mint === t.mint) === i);
  // le coin tracé : celui collé (CA), sinon le dernier lancé par l'adresse tracée
  const coin = all.find((t) => t.mint === result.fromToken?.mint) || all.find((t) => t.creator === result.start) || all[0] || null;
  const sample = all.slice(0, tokens);
  if (coin && !sample.some((t) => t.mint === coin.mint)) sample.push(coin);
  const devs = new Set([result.start, ...sample.map((t) => t.creator).filter(Boolean)]);
  const linked = new Set((result.wallets || []).map((w) => w.address));
  const network = new Set([...devs, ...(result.census?.devs || []).map((d) => d.address), ...(result.census?.siblings || []).map((s) => s.address), ...(result.wallets || []).filter((w) => w.tokens).map((w) => w.address)]);

  // 1. qui achète juste après le dev, token par token
  const perToken = [];
  let i = 0;
  for (const t of sample) {
    i++;
    log(`Premiers acheteurs ${i} / ${sample.length} : ${t.symbol || t.mint.slice(0, 6)}`);
    const r = await rpc.windowTxs(t.mint, t.createdAt - 2, t.createdAt + 20, 200, 'asc').catch(() => null);
    if (!r) continue;
    const eb = earlyBuyersFrom(r.txs, t.mint, t.creator, { first: coin && t.mint === coin.mint ? 20 : 8 });
    eb.buyers = eb.buyers.filter((b) => !devs.has(b.wallet));
    perToken.push({ mint: t.mint, symbol: t.symbol, buyers: eb.buyers });
  }
  // présence de chaque wallet « juste après le dev » sur ses tokens
  const presence = (w) => {
    const hits = perToken.map((p) => p.buyers.find((b) => b.wallet === w && (b.rank <= 5 || b.delay <= 3))).filter(Boolean);
    const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    return { tokens: hits.length, of: perToken.length, medianRank: med(hits.map((h) => h.rank)), medianDelay: med(hits.map((h) => h.delay)) };
  };
  const candidates = [];
  const coinAll = coin ? (perToken.find((p) => p.mint === coin.mint)?.buyers || []) : [];
  const coinBuyers = [...coinAll.slice(0, coinFirst), ...coinAll.slice(coinFirst).filter((b) => b.delay <= 0).slice(0, bundleMax)];
  for (const b of coinBuyers) candidates.push({ wallet: b.wallet, coinRank: b.rank, coinDelay: b.delay, bundle: b.delay <= 0, ...presence(b.wallet) });
  for (const c of rankEarlyWallets(perToken, { top })) if (!candidates.some((x) => x.wallet === c.wallet)) candidates.push({ ...c, ...presence(c.wallet) });
  log(`${candidates.length} wallets à vérifier : les premiers acheteurs et le bundle du coin (${coinBuyers.length}), et ceux qui reviennent sur ses tokens`);

  // 2. pour chacun : son entrée, son propre résultat, et la copie de ses achats récents
  for (const c of candidates) Object.assign(c, await analyseWallet(rpc, c.wallet, { network, linked, buys, maxAgeSec, emit }));
  candidates.sort((a, b) => (b.interesting - a.interesting) || (b.copyable - a.copyable) || ((b.summary?.bestPnlSol ?? -1e9) - (a.summary?.bestPnlSol ?? -1e9)));
  return { createdAt: Date.now(), coin: coin ? { mint: coin.mint, symbol: coin.symbol } : null, tokens: perToken.length, perToken: perToken.map((p) => ({ mint: p.mint, symbol: p.symbol, buyers: p.buyers.slice(0, 5) })), candidates, rule: 'snipers-v5' };
}

/**
 * Un wallet, analysé comme le ferait le bot qui le copie (un seul achat par token) :
 * - son entrée : achète-t-il à la fin de la 1re bougie ?
 * - son propre résultat : ses vrais achats et ventes, frais compris ;
 * - ses achats : des coins qui finissent en rug, des tokens de ce rugger (network) ?
 * - la copie : entrée à la clôture de la bougie d'une seconde de son achat, puis les ventes du user.
 */
export async function analyseWallet(rpc, wallet, { network = new Set(), linked = new Set(), buys = 12, maxAgeSec = 120, days = 3, txCap = 1000, sample = false, emit = () => {} } = {}) {
  const log = (msg) => emit({ type: 'log', msg });
  const now = Math.floor(Date.now() / 1000);
  const c = { wallet, linked: linked.has(wallet) };
  log(`Achats récents de ${wallet.slice(0, 4)}…${wallet.slice(-4)}`);
  const r = await rpc.windowTxs(wallet, now - days * 86400, now, txCap, 'desc').catch(() => null);
  if (!r) { c.error = 'lecture impossible'; return c; }
  const recent = recentBuysFrom(r.txs, wallet, { max: buys });
  c.recentBuys = recent.total; c.perHour = recent.perHour;
  // la période vraiment lue : pour un bot très actif, 1 000 transactions ne couvrent qu'une heure ou deux
  const span = (txs) => { const ts = txs.map((t) => t.time).filter(Boolean); return ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 3600 : 0; };
  let txs = r.txs;
  let hours = span(r.txs);
  let buyList = recent.buys;
  c.sampled = 0;
  // bot très actif : une heure peut être une mauvaise passe. On prend 14 tranches de 15 min réparties sur 7 jours,
  // pour son résultat et pour les achats rejoués.
  if (sample && hours < 24) {
    log('Wallet très actif : échantillons de 15 min répartis sur les 7 derniers jours');
    const slices = [];
    for (let i = 0; i < 14; i++) {
      const from = now - Math.round(((i + 0.5) / 14) * 7 * 86400);
      const sr = await rpc.windowTxs(wallet, from, from + 900, 1500, 'asc').catch(() => null);
      if (sr?.txs.length) slices.push(sr.txs);
    }
    c.sampled = slices.length;
    const seen = new Set(r.txs.map((t) => t.sig));
    for (const sl of slices) for (const t of sl) if (!seen.has(t.sig)) { seen.add(t.sig); txs.push(t); }
    hours += slices.reduce((x, sl) => x + span(sl), 0);
    // achats rejoués : quelques-uns par tranche, et quelques récents
    const per = Math.max(1, Math.floor((buys - 5) / Math.max(1, slices.length)));
    const picked = [...recent.buys.slice(0, 5)];
    for (const sl of slices) for (const b of recentBuysFrom(sl, wallet, { max: per }).buys) if (!picked.some((x) => x.mint === b.mint)) picked.push(b);
    buyList = picked.slice(0, buys);
  }
  const own = tradesFrom(txs, wallet).filter((t) => t.closed && t.spent > 0);
  c.own = { closed: own.length, wins: own.filter((t) => t.pnlSol > 0).length, pnlSol: own.reduce((x, t) => x + t.pnlSol, 0) };
  c.ownHours = hours || null;
  c.ownCapped = !!r.capped;
  c.copies = [];
  let late = 0; let j = 0;
  for (const b of buyList) {
    j++;
    emit({ type: 'progress', scanned: j, total: buyList.length, calls: 0 });
    if (j % 5 === 0) log(`Achats rejoués : ${j} / ${buyList.length}`);
    const ct = await curveTrades(rpc, b.mint, b.time - maxAgeSec, { windowSec: 7200 + maxAgeSec, full: true, noCreateAfter: b.time }).catch(() => null);
    if (!ct) { late++; continue; } // token créé bien avant son achat (ou hors pump.fun) : filtré par l'âge max
    const cp = copyTrade(ct, b.time);
    if (!cp) { late++; continue; }
    c.copies.push({ mint: b.mint, time: b.time, sol: b.sol, ...cp, migrated: ct.migrated, rug: isRugCurve(ct.points.filter((p) => p.t >= b.time), ct.migrated), sameRugger: !!ct.dev && network.has(ct.dev), dev: ct.dev || null });
  }
  c.late = late;
  const looked = c.copies.length + late;
  c.firstCandle = { n: c.copies.filter((x) => x.delay <= 1).length, of: looked };
  c.rugCoins = { n: c.copies.filter((x) => x.rug).length, of: c.copies.length };
  c.sameRugger = { n: c.copies.filter((x) => x.sameRugger).length, of: c.copies.length };
  c.summary = summarizeCopies(c.copies);
  c.copyable = c.summary.trades >= 5 && c.summary.bestPnlSol > 0;
  c.ruggerFollower = c.rugCoins.of > 0 && (c.rugCoins.n / c.rugCoins.of >= 0.5 || c.sameRugger.n / c.rugCoins.of >= 0.3);
  // F Project (copytrade) : on juge l'entrée — part en bloc 0 (même seconde que la création), entrée médiane, rythme —
  // pas son taux de gain ; un wallet qui crée des tokens est un dev (méthode 1), pas une cible de copie
  c.block0 = looked ? c.copies.filter((x) => x.delay <= 0).length / looked : null;
  c.entryMedian = (() => { const d = c.copies.map((x) => x.delay).sort((a, b) => a - b); return d.length ? d[Math.floor(d.length / 2)] : null; })();
  c.creates = txs.filter((t) => t.create && t.signers?.includes(wallet)).length;
  c.copyMints = c.copies.map((x) => x.mint);
  c.interesting = c.copyable && looked > 0 && c.firstCandle.n / looked >= 0.6 && !c.creates && (c.perHour == null || c.perHour <= 10) && c.ruggerFollower;
  c.style = walletStyle(own, c);
  log(`${wallet.slice(0, 4)}… : 1re bougie ${c.firstCandle.n}/${looked}, en profit sur ${c.own.wins}/${c.own.closed} tokens, coins rug ${c.rugCoins.n}/${c.rugCoins.of}, copie ${c.summary.bestPnlSol >= 0 ? '+' : ''}${c.summary.bestPnlSol.toFixed(2)} SOL`);
  return c;
}

const med = (xs) => { const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
/**
 * Sa stratégie, lue sur ses vrais trades : comment il entre, combien il mise, quand il sort, et ce que ça lui rapporte.
 * @param own trades fermés (realpnl.tradesFrom) ; c l'analyse en cours (entrées rejouées, période lue)
 */
export function walletStyle(own, c) {
  if (!own.length) return null;
  const wins = own.filter((t) => t.pnlSol > 0); const losses = own.filter((t) => t.pnlSol <= 0);
  const avg = (a) => (a.length ? a.reduce((x, t) => x + t.pct, 0) / a.length : null);
  const hold = (a) => med(a.map((t) => (t.lastSell && t.firstBuy ? t.lastSell - t.firstBuy : null)));
  const sumW = wins.reduce((x, t) => x + t.pnlSol, 0); const sumL = -losses.reduce((x, t) => x + t.pnlSol, 0);
  const hours = c.ownHours || null;
  const looked = (c.copies?.length || 0) + (c.late || 0);
  const st = {
    trades: own.length, hours, tradesPerHour: hours ? own.length / hours : null,
    size: med(own.map((t) => t.spent / Math.max(1, t.buys))), buysPerToken: med(own.map((t) => t.buys)), sellsPerToken: med(own.map((t) => t.sells)),
    // mise totale par token, gagnants contre perdants : un bot qui renforce ce qui monte mise bien plus sur ses gagnants
    stakeWin: med(wins.map((t) => t.spent)), stakeLoss: med(losses.map((t) => t.spent)),
    solWin: wins.reduce((x, t) => x + t.spent, 0), solLoss: losses.reduce((x, t) => x + t.spent, 0),
    holdWin: hold(wins), holdLoss: hold(losses), hold: hold(own),
    winrate: wins.length / own.length, avgWin: avg(wins), avgLoss: avg(losses),
    pnlSol: sumW - sumL, pnlPerHour: hours ? (sumW - sumL) / hours : null, profitFactor: sumL > 0 ? sumW / sumL : null,
    biggestWin: wins.length ? Math.max(...wins.map((t) => t.pnlSol)) : null,
    sameSecond: looked ? (c.copies || []).filter((x) => x.delay <= 0).length / looked : null,
    entryMc: med((c.copies || []).map((x) => x.entryMcSol)),
  };
  // le genre de wallet, en mots simples
  const h = st.hold ?? 0;
  st.type = h <= 60 ? 'Bot de scalping' : h <= 600 ? 'Trader rapide' : h <= 6 * 3600 ? 'Swing trader' : 'Holder';
  if ((st.tradesPerHour || 0) >= 20) st.type += ' haute fréquence';
  st.tags = [
    st.sameSecond != null && st.sameSecond >= 0.5 ? 'achète dans la seconde du lancement' : null,
    st.buysPerToken >= 2 ? `renforce ses positions (${st.buysPerToken} achats par token)` : null,
    st.sellsPerToken >= 2 ? 'vend en plusieurs fois' : null,
  ].filter(Boolean);
  return st;
}
