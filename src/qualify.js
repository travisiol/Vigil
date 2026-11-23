// Qualification « méthode 1 » d'un rugger, calquée sur les règles F Project :
// - échantillon : au moins 20 tokens couvrant au moins 72 h ;
// - entrée du sniper estimée à 75 % du prix de clôture de la première bougie (jamais sous le plancher) ;
// - le token « offre +100 % » si son plus haut, après la première bougie, vaut au moins 2 fois l'entrée ;
// - sinon la perte est le stop naturel : retour au plancher de la courbe (environ 28 SOL de market cap) ;
// - frais d'environ 0,038 SOL l'aller-retour -> achat minimum = 0,038 / gain moyen par trade.
// C'est une estimation faite sur des bougies d'une minute, pas le moteur de F Project.
import { gecko } from './gecko.js';

const P0 = 30 / 1.073e9; // prix plancher de la courbe pump.fun, en SOL
const SUPPLY = 1e9;
export const FEES_SOL = 0.038;
const WSOL = 'So11111111111111111111111111111111111111112';
export const MIN_TOKENS = 20, MIN_HOURS = 72;

/** @param candles bougies d'une minute triées par date : [t, ouverture, haut, bas, clôture], prix en SOL */
export function qualifyToken(candles) {
  if (!candles?.length) return null;
  const first = candles[0];
  // si les prix ne sont visiblement pas en SOL, on prend l'ouverture de la première bougie comme plancher
  const floor = first[1] >= P0 * 0.8 && first[1] <= P0 * 60 ? P0 : first[1];
  const entry = Math.max(floor, 0.75 * first[4]);
  const after = candles.slice(1);
  const ath = after.length ? Math.max(...after.map((c) => c[2])) : first[4];
  const peak = after.find((c) => c[2] === ath);
  const gain = ath / entry - 1;
  return {
    entryMcSol: entry * SUPPLY, athMcSol: ath * SUPPLY, firstCandleMcSol: first[4] * SUPPLY,
    gainPct: gain * 100, hit: gain >= 1, naturalSlPct: -(1 - floor / entry) * 100,
    minutesToAth: peak ? Math.round((peak[0] - first[0]) / 60) : 0,
  };
}

/**
 * Règle de trade :
 * - entrée à la clôture de la 1re bougie (bougies d'une seconde : le prix après le dernier trade de la seconde de création) ;
 * - si le prix touche ensuite au moins une fois 2 fois l'entrée : vente à +100 % ;
 * - sinon : perte de l'entrée jusqu'au plus bas atteint ensuite (le sell total possible).
 * Sans stop, l'ordre des mouvements ne change rien : seuls le plus haut et le plus bas après l'entrée comptent.
 * @param points [{ t, mc }] market cap en SOL après chaque trade (ou clôtures de bougies), dans l'ordre
 */
/**
 * Stratégies de vente du user. Chaque palier : [multiple du prix d'entrée, part du sac RESTANT vendue].
 * Ce qui reste après le dernier palier touché est perdu jusqu'au plus bas atteint ensuite (même règle que +100 %).
 */
export const RULE = 'fin-1re-bougie-plus-bas-v7'; // v7 : jusqu'à 30 tokens (cerveau F Project : ~30, au moins 20 sur 72 h)
export const STRATEGIES = [
  { id: 's1', label: '100 % à +100 %', levels: [[2, 1]] },
  { id: 's2', label: '50 % à +100 % · tout le reste à +200 %', levels: [[2, 0.5], [3, 1]] },
  { id: 's3', label: '50 % à +100 % · 50 % du reste à +200 % · tout le reste à +400 %', levels: [[2, 0.5], [3, 0.5], [5, 1]] },
];
const TOP_MULT = Math.max(...STRATEGIES.flatMap((st) => st.levels.map((l) => l[0])));

/** Rejoue une stratégie sur les points après l'entrée. migrated : le dernier point est la migration (on sort le reste là). */
export function simulate(after, entry, levels, migrated = false) {
  let pos = 1; let cash = 0; let i = 0; let lastHit = -1;
  const times = [];
  for (let k = 0; k < after.length && pos > 1e-9; k++) {
    while (i < levels.length && after[k].mc >= entry * levels[i][0]) {
      const part = pos * levels[i][1];
      cash += part * levels[i][0]; pos -= part; times.push(after[k].t); lastHit = k; i++;
    }
  }
  // ce qui reste après le dernier palier touché : revendu au plus bas atteint ensuite (ou au prix de migration)
  const sold = cash; const rest = pos > 1e-9 ? pos : 0;
  let exit = 1;
  if (rest && after.length) {
    const tail = after.slice(Math.max(0, lastHit));
    exit = (migrated ? after[after.length - 1].mc : Math.min(...tail.map((p) => p.mc))) / entry;
  }
  cash += rest * exit;
  return { pct: (cash - 1) * 100, hits: times.length, of: levels.length, times, sold, rest, exit };
}

/**
 * Plafond de perte optionnel (non utilisé : le user veut la revente au plus bas atteint, comme avant).
 * cap = null → au plus bas atteint ; cap = 0,3 → jamais sous 70 % du prix d'entrée.
 */
export const LOSS_CAP = null;
export function cappedPct(o, cap = LOSS_CAP) {
  if (!o) return 0;
  if (cap == null || o.rest == null) return o.pct;
  return (o.sold + o.rest * Math.max(o.exit, 1 - cap) - 1) * 100;
}

export function backtestPoints(points, firstSecond, { migrated = false } = {}) {
  if (!points?.length) return null;
  const t0 = firstSecond ?? points[0].t;
  const firstCandle = points.filter((p) => p.t <= t0);
  const entry = (firstCandle.length ? firstCandle[firstCandle.length - 1] : points[0]).mc;
  const after = points.filter((p) => p.t > t0);
  if (!after.length) return { entryMcSol: entry, athMcSol: entry, lowMcSol: entry, outcome: 'open', pct: 0, seconds: 0, strategies: Object.fromEntries(STRATEGIES.map((st) => [st.id, { pct: 0, hits: 0, of: st.levels.length, seconds: [] }])) };
  let ath = -Infinity; let low = Infinity; let hitAt = null; let dropAt = null;
  for (const p of after) {
    if (p.mc > ath) ath = p.mc;
    if (p.mc < low) low = p.mc;
    if (hitAt == null && p.mc >= 2 * entry) hitAt = p.t;
    if (dropAt == null && p.mc <= 0.6 * entry) dropAt = p.t; // l'effondrement (le rug), s'il arrive
  }
  const dropSeconds = dropAt != null ? dropAt - t0 : null;
  const strategies = Object.fromEntries(STRATEGIES.map((st) => {
    const r = simulate(after, entry, st.levels, migrated);
    return [st.id, { pct: r.pct, hits: r.hits, of: r.of, sold: r.sold, rest: r.rest, exit: r.exit, seconds: r.times.map((x) => x - t0) }];
  }));
  if (hitAt != null) return { entryMcSol: entry, athMcSol: ath, lowMcSol: low, outcome: 'tp', pct: 100, seconds: hitAt - t0, dropSeconds, strategies };
  return { entryMcSol: entry, athMcSol: ath, lowMcSol: low, outcome: 'loss', pct: (low / entry - 1) * 100, seconds: after[after.length - 1].t - t0, dropSeconds, strategies };
}

// Bougies d'une minute (GeckoTerminal, sans clé Helius) : approximation, la 1re bougie dure une minute au lieu d'une seconde.
export function backtestToken(candles) {
  if (!candles?.length) return null;
  const pts = [{ t: candles[0][0], mc: candles[0][4] * SUPPLY }];
  for (const c of candles.slice(1)) pts.push({ t: c[0], mc: c[2] * SUPPLY }, { t: c[0] + 1, mc: c[3] * SUPPLY });
  const r = backtestPoints(pts, candles[0][0]);
  return r && { ...r, precision: 'minute' };
}

/**
 * Prix exact trade par trade, depuis la courbe pump.fun.
 * Le prix ne dépend que des tokens restant dans la courbe : prix = k / (réserve virtuelle de tokens)².
 * Ça marche aussi pour les tokens cotés dans une autre monnaie que le SOL (USDC…), où aucun SOL n'entre dans la courbe.
 * Market cap affichée en équivalent SOL (exacte pour un token coté en SOL ; les pourcentages sont exacts dans tous les cas).
 */
const V_TOK0 = 1.073e9;
const FOR_SALE = 793.1e6;
const mcOf = (sold) => (30 * V_TOK0 / (V_TOK0 - sold) ** 2) * 1e9;
export async function curveTrades(rpc, mint, createdAt, { windowSec = 7200, cap = 5000, dev = null, full = false, noCreateAfter = null } = {}) {
  if (!rpc?.windowTxs) return null;
  const st = { curve: null, held: 0, t0: null, migrated: false, quoteSol: true, points: [], done: 0, entry: null, hit: false, createSig: null, dev, devHeld: 0, devSell: null, devTop: false };
  // traite les transactions au fil des pages ; s'arrête dès que le +100 % est touché (le résultat ne peut plus changer)
  const feed = (txs) => {
    for (; st.done < txs.length; st.done++) {
      const t = txs[st.done];
      if (st.migrated) return true;
      if (!st.curve) {
        if (noCreateAfter != null && t.time > noCreateAfter) return true; // token créé avant la fenêtre : on arrête
        if (t.create?.mint !== mint) continue;
        const own = t.tokenDelta.filter((d) => d.mint === mint && d.delta > 0).sort((a, b) => b.delta - a.delta)[0];
        if (!own) continue;
        st.curve = own.owner; st.t0 = t.time; st.createSig = t.sig;
        st.dev = st.dev || t.feePayer || t.signers?.[0] || null;
        const devBuy = t.tokenDelta.find((d) => d.mint === mint && d.owner !== st.curve && d.delta > 0);
        if (devBuy && devBuy.delta > 1e6 && Math.abs(t.solDelta[st.curve] || 0) < 0.01e9) st.quoteSol = false;
      }
      const d = t.tokenDelta.find((x) => x.mint === mint && x.owner === st.curve);
      if (!d && t.sig !== st.createSig) continue;
      st.held += d ? d.delta : 0;
      const sold = Math.max(0, 1e9 - st.held);
      if (sold >= FOR_SALE) { st.migrated = true; st.points.push({ t: t.time, mc: mcOf(FOR_SALE) }); return true; }
      const p = { t: t.time, mc: mcOf(sold) };
      st.points.push(p);
      // le dev (le créateur) : ses achats et sa première vente dans la courbe (pour « Achat sur vente du dev »)
      const dv = st.dev ? t.tokenDelta.find((x) => x.mint === mint && x.owner === st.dev) : null;
      if (dv && dv.delta > 0) st.devHeld += dv.delta;
      else if (dv && dv.delta < 0 && !st.devSell) {
        st.devSell = { t: t.time, idx: st.points.length - 1, mc: p.mc, pctSupply: (-dv.delta / 1e9) * 100, pctBag: st.devHeld > 0 ? Math.min(100, (-dv.delta / st.devHeld) * 100) : null };
        st.devHeld += dv.delta;
      } else if (dv && dv.delta < 0) st.devHeld += dv.delta;
      if (st.devSell && p.mc >= TOP_MULT * st.devSell.mc) st.devTop = true;
      if (t.time === st.t0) st.entry = p.mc; // clôture de la 1re bougie (dernier trade de la seconde de création)
      else if (st.entry != null && p.mc >= 2 * st.entry) { st.hit = true; if (p.mc >= TOP_MULT * st.entry) st.top = true; }
      // on peut s'arrêter quand les deux entrées (lancement et vente du dev) ont touché le dernier palier
      if (!full && st.top && st.devTop) return true;
    }
    return false;
  };
  const r = await rpc.windowTxs(mint, createdAt - 2, createdAt + windowSec, cap, 'asc', (out) => feed(out));
  if (!r) return null;
  feed(r.txs);
  if (!st.curve) return null;
  return { points: st.points, t0: st.t0, trades: st.points.length, capped: r.capped && !st.migrated && !(st.top && st.devTop), migrated: st.migrated, quoteSol: st.quoteSol, early: st.hit, devSell: st.devSell, dev: st.dev };
}

/**
 * Achat sur vente du dev (F Project §11.5, « Buy on Dev Sell ») : on achète juste après sa première vente,
 * puis mêmes stratégies de vente. Pas de vente du dev = pas d'achat (ni gain ni frais).
 */
export function devSellTrade(ct) {
  const ds = ct?.devSell;
  if (!ds) return { sold: false };
  const after = ct.points.slice(ds.idx + 1);
  const strategies = Object.fromEntries(STRATEGIES.map((st) => {
    const r = simulate(after, ds.mc, st.levels, ct.migrated);
    return [st.id, { pct: r.pct, hits: r.hits, of: r.of, sold: r.sold, rest: r.rest, exit: r.exit }];
  }));
  return { sold: true, seconds: ds.t - ct.t0, pctSupply: ds.pctSupply, pctBag: ds.pctBag, entryMcSol: ds.mc, strategies };
}

/** Bilan « achat sur vente du dev » et plage de % de supply à mettre dans le bot. */
export function summarizeDevSell(rows, buySol = 0.15, cap = LOSS_CAP) {
  const ok = rows.filter(Boolean);
  const sold = ok.filter((d) => d.sold);
  if (!ok.length) return null;
  const pcts = sold.map((d) => d.pctSupply).filter((x) => x > 0).sort((a, b) => a - b);
  const secs = sold.map((d) => d.seconds).sort((a, b) => a - b);
  const strategies = STRATEGIES.map((st) => {
    const p = sold.map((d) => cappedPct(d.strategies[st.id], cap));
    return { id: st.id, label: st.label, pnlSol: p.reduce((x, v) => x + (buySol * v) / 100, 0) - sold.length * FEES_SOL, avgPct: p.length ? p.reduce((x, v) => x + v, 0) / p.length : 0, full: sold.filter((d) => d.strategies[st.id].hits === st.levels.length).length };
  });
  return {
    tokens: ok.length, sold: sold.length, share: sold.length / ok.length,
    medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null,
    range: pcts.length ? [Math.max(0, Math.floor(pcts[0] * 0.8 * 10) / 10), Math.min(100, Math.ceil(pcts[pcts.length - 1] * 1.2 * 10) / 10)] : null,
    strategies,
  };
}

/**
 * Délai de snipe (F Project §11.7) : si ses mauvais tokens s'effondrent en quelques secondes alors que ses bons
 * mettent plus longtemps à faire +100 %, un délai de quelques secondes + un Min MC filtre les ratés.
 */
export function suggestDelay(trades) {
  const ok = trades.filter(Boolean);
  const drops = ok.filter((t) => t.outcome !== 'tp' && t.dropSeconds != null).map((t) => t.dropSeconds).sort((a, b) => a - b);
  const wins = ok.filter((t) => t.outcome === 'tp').map((t) => t.seconds).sort((a, b) => a - b);
  if (drops.length < 2 || !wins.length) return null;
  const p75 = drops[Math.min(drops.length - 1, Math.floor(drops.length * 0.75))];
  const delay = Math.max(2, Math.ceil(p75 + 1));
  if (delay > 15) return null;
  const keptWins = wins.filter((s) => s > delay).length;
  if (keptWins / wins.length < 0.8) return null; // le délai ferait rater trop de bons tokens
  return { delay, losersFiltered: drops.filter((s) => s <= delay).length, losers: ok.filter((t) => t.outcome !== 'tp').length, winsKept: keptWins, wins: wins.length };
}

/** Bilan des trades simulés. buySol : mise par trade ; frais F Project d'environ 0,038 SOL par aller-retour. */
export function summarizeBacktest(trades, buySol = 0.15, cap = LOSS_CAP) {
  const ok = trades.filter(Boolean);
  const p1 = (t) => (t.strategies?.s1 ? cappedPct(t.strategies.s1, cap) : t.pct); // tout à +100 %, perte plafonnée
  const wins = ok.filter((t) => p1(t) > 0).length;
  const losses = ok.filter((t) => t.outcome === 'loss');
  const avgPct = ok.length ? ok.reduce((s, t) => s + p1(t), 0) / ok.length : 0;
  const pnlSol = ok.reduce((s, t) => s + (buySol * p1(t)) / 100, 0) - ok.length * FEES_SOL;
  return {
    trades: ok.length, wins, tp: ok.filter((t) => t.outcome === 'tp').length, rugs: losses.length,
    avgLossPct: losses.length ? losses.reduce((s2, t) => s2 + p1(t), 0) / losses.length : 0, lossCap: cap,
    winRate: ok.length ? wins / ok.length : 0, avgPct, buySol, feesSol: ok.length * FEES_SOL, pnlSol,
    minBuySol: avgPct > 0 ? FEES_SOL / (avgPct / 100) : null,
    verdict: !ok.length ? 'none' : pnlSol > 0 ? 'win' : 'loss',
    strategies: STRATEGIES.map((st) => {
      const pcts = ok.map((t) => (t.strategies?.[st.id] ? cappedPct(t.strategies[st.id], cap) : st.id === 's1' ? t.pct : 0));
      return { id: st.id, label: st.label, pnlSol: pcts.reduce((s2, p) => s2 + (buySol * p) / 100, 0) - ok.length * FEES_SOL, avgPct: pcts.length ? pcts.reduce((s2, p) => s2 + p, 0) / pcts.length : 0, full: ok.filter((t) => t.strategies?.[st.id] && t.strategies[st.id].hits === st.levels.length).length };
    }),
  };
}

export function summarizeSample(rows) {
  const ok = rows.filter((r) => r.gainPct != null);
  const times = ok.map((r) => r.createdAt).filter(Boolean);
  const spanHours = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600 : 0;
  const hits = ok.filter((r) => r.hit).length;
  // prise de profit à +100 % si elle est atteinte, sinon stop naturel au plancher
  const outcomes = ok.map((r) => (r.hit ? 100 : r.naturalSlPct));
  const avgGainPct = outcomes.length ? outcomes.reduce((s, x) => s + x, 0) / outcomes.length : 0;
  const enough = ok.length >= MIN_TOKENS && spanHours >= MIN_HOURS;
  return {
    analysed: ok.length, missing: rows.length - ok.length, spanHours, hits, hitRate: ok.length ? hits / ok.length : 0,
    avgGainPct, totalGainPct: outcomes.reduce((s, x) => s + x, 0),
    avgNaturalSlPct: ok.length ? ok.reduce((s, r) => s + r.naturalSlPct, 0) / ok.length : 0,
    minBuySol: avgGainPct > 0 ? FEES_SOL / (avgGainPct / 100) : null,
    verdict: !ok.length ? 'none' : !enough ? 'thin' : avgGainPct > 0 ? 'qualified' : 'negative',
  };
}

/**
 * @param result  enquête enregistrée (tokens du cluster + tokens des wallets frères)
 * @param cache   src/cache.js
 */
export async function qualify(result, cache, emit = () => {}, { max = 30, rpc = null } = {}) {
  const log = (msg) => emit({ type: 'log', msg });
  const now = Math.floor(Date.now() / 1000);
  const sample = [...result.tokens, ...(result.after || []).filter((t) => !t.groupBuy), ...(result.siblingTokens || [])]
    .filter((t) => t.mint && t.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((t, i, all) => all.findIndex((x) => x.mint === t.mint) === i)
    .slice(0, max)
    .map((t) => ({ mint: t.mint, name: t.name, symbol: t.symbol, creator: t.creator, createdAt: t.createdAt, viaSource: t.viaSource || null }));
  log(`Qualification sur les ${sample.length} tokens les plus récents`);

  // adresse de la courbe pump.fun de chaque token (c'est elle qui porte les bougies de la première heure)
  const pairs = new Map();
  for (let i = 0; i < sample.length; i += 30) {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${sample.slice(i, i + 30).map((t) => t.mint).join(',')}`, { signal: AbortSignal.timeout(15000) });
      for (const p of res.ok ? await res.json() : []) {
        if (p.quoteToken?.address !== WSOL) continue;
        const mint = p.baseToken?.address;
        if (!pairs.has(mint) || p.dexId === 'pumpfun') pairs.set(mint, p.pairAddress);
      }
    } catch { /* paires inconnues pour ce lot */ }
  }

  let done = 0;
  for (const t of sample) {
    done++;
    if (rpc?.provider === 'helius') {
      log(`Trades ${done} / ${sample.length} : ${t.symbol || t.mint.slice(0, 6)}`);
      const ct = await curveTrades(rpc, t.mint, t.createdAt, { dev: t.creator || null }).catch(() => null);
      if (ct?.points.length) {
        t.bt = { ...backtestPoints(ct.points, ct.t0, { migrated: ct.migrated }), devSell: devSellTrade(ct), precision: 'seconde', trades: ct.trades, partial: ct.capped, migrated: ct.migrated, quoteSol: ct.quoteSol };
        continue;
      }
    }
    let candles = cache.getKv(`candles:${t.mint}`);
    if (!candles) {
      const pair = pairs.get(t.mint);
      if (!pair) { t.missing = 'paire inconnue'; continue; }
      log(`Bougies ${done} / ${sample.length} : ${t.symbol || t.mint.slice(0, 6)}`);
      emit({ type: 'progress', scanned: done, total: sample.length, calls: 0 });
      const before = Math.min(now, t.createdAt + 3600);
      for (let attempt = 0; attempt < 3 && !candles; attempt++) {
        try {
          const j = await gecko(`pools/${pair}/ohlcv/minute?aggregate=1&before_timestamp=${before}&limit=70&currency=token`);
          candles = (j.data?.attributes?.ohlcv_list || []).map((x) => x.slice(0, 5).map(Number)).filter((x) => x[0] >= t.createdAt - 60).sort((a, b) => a[0] - b[0]);
          if (now - t.createdAt > 7200) cache.putKv(`candles:${t.mint}`, candles); // la première heure d'un vieux token ne changera plus
        } catch (e) {
          // limite atteinte : le prochain appel attend de lui-même qu'un créneau se libère
          t.missing = e.status === 429 ? 'limite GeckoTerminal' : 'bougies indisponibles';
          if (e.status !== 429) break;
          log('Limite de la source de bougies atteinte, attente d\'un créneau…');
        }
      }
      if (!candles) continue;
      delete t.missing;
    }
    const q = qualifyToken(candles);
    if (!q) { t.missing = 'aucune bougie'; continue; }
    Object.assign(t, q);
    t.bt = backtestToken(candles);
  }
  const summary = summarizeSample(sample);
  const backtest = summarizeBacktest(sample.map((t) => t.bt));
  backtest.delay = suggestDelay(sample.map((t) => t.bt));
  backtest.devSell = summarizeDevSell(sample.map((t) => t.bt?.devSell));
  if (backtest.devSell?.sold) {
    const bestLaunch = Math.max(...backtest.strategies.map((x) => x.pnlSol));
    const bestDev = backtest.devSell.strategies.reduce((b, x) => (x.pnlSol > b.pnlSol ? x : b));
    // conseillé seulement s'il vend presque à chaque fois et que ça rapporte plus que l'achat au lancement
    backtest.devSell.better = backtest.devSell.share >= 0.7 && bestDev.pnlSol > 0 && bestDev.pnlSol > bestLaunch;
    backtest.devSell.best = bestDev.id;
    log(`Achat sur vente du dev : il a vendu sur ${backtest.devSell.sold} / ${backtest.devSell.tokens} tokens, meilleure vente ${bestDev.pnlSol >= 0 ? '+' : ''}${bestDev.pnlSol.toFixed(2)} SOL`);
  }
  for (const st of backtest.strategies) log(`${st.label} : ${st.pnlSol >= 0 ? '+' : ''}${st.pnlSol.toFixed(2)} SOL`);
  log(`${backtest.trades} trades simulés : ${backtest.tp} à +100 %, ${backtest.rugs} perdants, ${backtest.pnlSol >= 0 ? '+' : ''}${backtest.pnlSol.toFixed(2)} SOL avec 0,15 SOL par trade`);
  return { createdAt: Date.now(), tokens: sample, summary, backtest, rule: RULE };
}
