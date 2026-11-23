/**
 * Bilan réel : les vrais trades du wallet du user (achats et ventes pump.fun lus sur la chaîne),
 * regroupés par dev, et comparés à ce que l'outil avait prévu pour ce dev (et pour ce token, s'il était dans le calcul).
 */
const WSOL = 'So11111111111111111111111111111111111111112';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** SOL qui bouge pour le wallet dans une transaction (SOL natif + wSOL), en SOL. */
const solMove = (t, w) => (t.solDelta[w] || 0) / 1e9 + t.tokenDelta.filter((d) => d.owner === w && d.mint === WSOL).reduce((s, d) => s + d.delta, 0);

/**
 * Trades par token à partir des transactions du wallet.
 * - Le token tradé est celui dont la quantité bouge le plus dans la transaction ; les autres (petites quantités) sont la monnaie
 *   de cotation (USDC, TTWo… : « Pump custom »). Elle est convertie en SOL au taux payé à l'achat.
 * - Tout ce qui sort ou entre en SOL compte, frais compris (bribe, tip, frais du bot) : c'est le vrai résultat.
 */
export function tradesFrom(txs, wallet) {
  const byMint = new Map();
  const quoteMints = new Set();
  for (const t of [...txs].sort((a, b) => (a.time || 0) - (b.time || 0))) {
    const mine = t.tokenDelta.filter((d) => d.owner === wallet && d.mint !== WSOL && d.delta);
    if (!mine.length) continue;
    const traded = mine.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
    const quotes = mine.filter((d) => d !== traded);
    const sol = solMove(t, wallet);
    const e = byMint.get(traded.mint) || { mint: traded.mint, spent: 0, net: 0, bought: 0, sold: 0, firstBuy: null, lastSell: null, buys: 0, sells: 0, sellFees: 0, quote: null };
    if (traded.delta > 0) {
      e.bought += traded.delta; e.buys++; e.firstBuy ??= t.time;
      e.spent += Math.max(0, -sol); e.net += sol;
      // coté hors SOL : la courbe reçoit la monnaie de cotation ; taux = SOL payé / monnaie versée
      const curve = t.tokenDelta.find((d) => d.mint === traded.mint && d.delta < 0 && d.owner !== wallet)?.owner;
      const paid = curve ? t.tokenDelta.find((d) => d.owner === curve && d.mint !== traded.mint && d.mint !== WSOL && d.delta > 0) : null;
      if (paid && -sol > 0) { e.quote = { mint: paid.mint, rate: -sol / paid.delta }; quoteMints.add(paid.mint); }
    } else {
      e.sold += -traded.delta; e.sells++; e.lastSell = t.time;
      e.net += sol;
      if (sol < 0) e.sellFees += -sol;
    }
    for (const q of quotes) {
      if (e.quote && q.mint === e.quote.mint) e.net += q.delta * e.quote.rate;
      quoteMints.add(q.mint);
    }
    byMint.set(traded.mint, e);
  }
  return [...byMint.values()].filter((e) => e.buys > 0 && !quoteMints.has(e.mint)).map((e) => {
    const closed = e.sold >= e.bought * 0.99;
    return { ...e, closed, got: e.spent + e.net, pnlSol: e.net, pct: e.spent > 0 ? (e.net / e.spent) * 100 : null, quoteMint: e.quote?.mint || null };
  }).sort((a, b) => (b.firstBuy || 0) - (a.firstBuy || 0));
}

/** Index des enquêtes : créateur → enquête, et token → prévision de l'outil. */
export function indexInvestigations(invs) {
  const byCreator = new Map(); const byMint = new Map();
  for (const r of [...invs].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const link = { id: r.id, start: r.start, verdict: r.advice?.verdict || null, pattern: r.pattern?.title || null };
    const creators = new Set([r.start, ...(r.census?.devs || []).map((d) => d.address), ...(r.census?.siblings || []).map((s) => s.address),
      ...[...(r.tokens || []), ...(r.siblingTokens || []), ...(r.after || [])].map((t) => t.creator).filter(Boolean)]);
    for (const c of creators) byCreator.set(c, link);
    for (const t of r.qualification?.tokens || []) if (t.bt) byMint.set(t.mint, { id: r.id, bt: t.bt });
    const bts = (r.qualification?.tokens || []).map((t) => t.bt).filter(Boolean);
    if (bts.length) {
      link.predicted = Object.fromEntries(['s1', 's2', 's3'].map((id) => [id, bts.reduce((x, t) => x + (t.strategies?.[id]?.pct ?? (id === 's1' ? t.pct : 0)), 0) / bts.length]));
      link.predictedN = bts.length;
    }
  }
  return { byCreator, byMint };
}

async function windowRetry(rpc, ...args) {
  for (let i = 0; i < 4; i++) {
    rpc.noWindowApi = false;
    const r = await rpc.windowTxs(...args).catch(() => null);
    if (r) return r;
    await sleep(4000 * (i + 1)); // limite de débit (une chasse en cours, par exemple) : on attend
  }
  return null;
}

/** Le créateur d'un token acheté au lancement : la création est juste avant son achat. */
async function creatorOf(rpc, mint, buyTime) {
  const r = await windowRetry(rpc, mint, buyTime - 180, buyTime + 1, 60, 'asc');
  const c = r?.txs.find((t) => t.create?.mint === mint);
  return c ? { creator: c.feePayer, createdAt: c.time } : null;
}

export async function realReport(rpc, wallet, invs, emit = () => {}, { days = 7 } = {}) {
  const log = (msg) => emit({ type: 'log', msg });
  if (rpc?.provider !== 'helius') throw new Error('Il faut la clé Helius pour lire tes trades.');
  const now = Math.floor(Date.now() / 1000);
  log(`Lecture de tes transactions des ${days} derniers jours`);
  let w = await windowRetry(rpc, wallet, now - days * 86400, now, 4000, 'desc');
  if (!w) {
    // lecture par fenêtre bloquée (limite Helius) : on passe par la liste des signatures, une transaction à la fois
    log('Lecture par fenêtre indisponible : lecture une par une');
    const sigs = []; let before;
    for (let i = 0; i < 5; i++) {
      const p = await rpc.sigsPage(wallet, before, 1000);
      sigs.push(...p.filter((x) => !x.err && (x.blockTime ?? 0) >= now - days * 86400));
      if (p.length < 1000 || (p[p.length - 1].blockTime ?? 0) < now - days * 86400) break;
      before = p[p.length - 1].signature;
    }
    const txs = [];
    for (let i = 0; i < sigs.length; i += 20) txs.push(...(await Promise.all(sigs.slice(i, i + 20).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean));
    w = { txs, capped: false };
  }
  const trades = tradesFrom(w.txs, wallet);
  log(`${trades.length} tokens tradés : recherche de leur dev`);
  const idx = indexInvestigations(invs);
  let i = 0;
  for (const t of trades) {
    i++;
    if (i % 5 === 0) log(`Devs retrouvés : ${i} / ${trades.length}`);
    const known = idx.byMint.get(t.mint);
    const c = await creatorOf(rpc, t.mint, t.firstBuy);
    if (c) { t.creator = c.creator; t.delay = t.firstBuy - c.createdAt; }
    t.link = (t.creator && idx.byCreator.get(t.creator)) || null;
    if (known) t.predictedId = known.id;
    if (known) t.predicted = Object.fromEntries(['s1', 's2', 's3'].map((id) => [id, known.bt.strategies?.[id]?.pct ?? (id === 's1' ? known.bt.pct : null)]));
  }
  // par dev
  const byDev = new Map();
  for (const t of trades.filter((x) => x.closed)) {
    const k = t.link?.id || t.creator || 'inconnu'; // un rugger = son enquête (ses devs jetables sont regroupés)
    const d = byDev.get(k) || { creator: t.link?.start || t.creator || null, devs: new Set(), link: t.link, trades: 0, wins: 0, spent: 0, pnlSol: 0, pcts: [] };
    d.devs.add(t.creator); d.trades++; d.wins += t.pnlSol > 0 ? 1 : 0; d.spent += t.spent; d.pnlSol += t.pnlSol; d.pcts.push(t.pct);
    byDev.set(k, d);
  }
  const devs = [...byDev.values()].map((d) => ({ ...d, devs: d.devs.size, avgPct: d.pcts.reduce((x, y) => x + y, 0) / d.pcts.length })).sort((a, b) => a.pnlSol - b.pnlSol);
  const closed = trades.filter((t) => t.closed);
  const wins = closed.filter((t) => t.pnlSol > 0); const losses = closed.filter((t) => t.pnlSol <= 0);
  const avg = (a) => (a.length ? a.reduce((x, t) => x + t.pct, 0) / a.length : null);
  return {
    createdAt: Date.now(), wallet, days, partial: w.capped,
    totals: { trades: closed.length, open: trades.length - closed.length, wins: wins.length, losses: losses.length, pnlSol: closed.reduce((x, t) => x + t.pnlSol, 0), spent: closed.reduce((x, t) => x + t.spent, 0), avgWin: avg(wins), avgLoss: avg(losses) },
    devs, trades,
  };
}
