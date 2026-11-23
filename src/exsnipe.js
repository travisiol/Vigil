/**
 * Snipe exchange : le dossier complet d'un rugger retiré d'un exchange (Binance, Coinbase…).
 *
 * 1. Financement : tous les retraits d'exchange de son dev avant le lancement, et le délai retrait → lancement.
 * 2. Même montant ailleurs : les autres devs retirés du même exchange avec le même montant exact (±0,0001 SOL),
 *    trouvés par la traque (72 h, tous ses hot wallets) et dans tes enquêtes passées.
 * 3. Son bundle : chaque wallet qui achète dans le bloc de création ou juste après est passé au crible.
 *    À lui (il s'auto-snipe) ou sniper ? Indices : financé par le dev ou le même exchange juste avant, wallet neuf,
 *    revend en même temps que le rug, renvoie son SOL vers le dev ou vers les mêmes adresses que lui.
 * 4. Ses autres tokens : ses wallets de bundle ont acheté d'autres tokens à leur naissance ; leurs devs, et comment
 *    ils ont été financés (même exchange ? même montant ?).
 * 5. Verdict et réglages du bot (noms exacts de l'écran F Project).
 */
import { labelOf, LABELS } from './labels.js';
import { earlyBuyersFrom, recentBuysFrom } from './snipers.js';
import { rugWallets } from './wallethunt.js';

const SOL = 1e9;
export const EXSNIPE = {
  tol: 0.0001, // plage F Project pour un exchange
  walletTx: 300, // transactions lues par wallet du bundle (un wallet neuf en a bien moins)
  freshMax: 15, // au plus 15 transactions avant le lancement : wallet neuf
  sniperTx: 200, // plus de 200 transactions avant : bot de snipe ou trader
  sniperMints: 15, // achète plus de 15 tokens différents : sniper
  rugSellSec: 60, // revend à moins d'une minute de la vente du dev
  fundHours: 24, // financé au plus 24 h avant le lancement
  selfSnipeSec: 3, // achète un token dans les 3 s qui suivent sa création : à sa naissance
  maxBundle: 10,
  firstBuyers: 4,
  maxOtherTokens: 14,
};
const GENERIC = new Set(['Exchange', 'Exchange sans nom', 'Wallet à forte activité']);
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '?');
const fr = (n, d = 4) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const sameAmount = (a, b) => Math.abs(a - b) <= EXSNIPE.tol + 1e-9;
const exName = (addr) => { const l = labelOf(addr); return l?.type === 'exchange' ? l.name : null; };
const sameExchange = (a, b) => a && b && !GENERIC.has(a) && a === b;

/** Le plus gros SOL reçu avant `before` (virement, ou SOL déplacé par un programme : celui qui a payé la transaction). */
export function fundingFrom(txs, address, before) {
  let best = null;
  for (const t of txs) {
    if (before && t.time >= before) continue;
    const tr = (t.transfers || []).filter((x) => x.to === address && x.from !== address && x.lamports >= 0.005 * SOL).sort((a, b) => b.lamports - a.lamports)[0];
    let c = tr ? { funder: tr.from, sol: tr.lamports / SOL, at: t.time, sig: t.sig } : null;
    if (!c && t.feePayer && t.feePayer !== address && (t.solDelta?.[address] || 0) >= 0.005 * SOL) c = { funder: t.feePayer, sol: t.solDelta[address] / SOL, at: t.time, sig: t.sig };
    if (c && (!best || c.sol > best.sol)) best = c;
  }
  if (best) best.exchange = exName(best.funder);
  return best;
}

/** Tous les retraits d'exchange reçus avant `before`. */
export function withdrawalsFrom(txs, address, before) {
  const out = [];
  for (const t of txs) {
    if (before && t.time >= before) continue;
    for (const tr of t.transfers || []) {
      if (tr.to !== address || tr.from === address || tr.lamports < 0.005 * SOL) continue;
      const name = exName(tr.from);
      if (name) out.push({ hot: tr.from, name, sol: tr.lamports / SOL, at: t.time, sig: t.sig });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Première vente d'un token par un wallet. */
const firstSell = (txs, owner, mint, after = 0) => txs.find((t) => t.time >= after && (t.tokenDelta || []).some((d) => d.owner === owner && d.mint === mint && d.delta < 0))?.time ?? null;

/** SOL envoyé par un wallet après `after` (≥ 0,05 SOL) : les adresses où il le renvoie. */
const sentTo = (txs, owner, after) => {
  const out = new Map();
  for (const t of txs) {
    if (t.time < after) continue;
    for (const tr of t.transfers || []) if (tr.from === owner && tr.to !== owner && tr.lamports >= 0.05 * SOL) out.set(tr.to, (out.get(tr.to) || 0) + tr.lamports / SOL);
  }
  return out;
};

/**
 * Un wallet du bundle : est-il au rugger ?
 * ctx = { dev, devFunder, exchange, createdAt, mint, devSellAt, devDests:Set }
 */
export function judgeBundleWallet(w, txs, capped, ctx) {
  const before = txs.filter((t) => t.time < ctx.createdAt);
  const txBefore = capped ? Math.max(before.length, EXSNIPE.sniperTx) : before.length;
  const fund = fundingFrom(txs, w.wallet, ctx.createdAt + 1);
  const buys = recentBuysFrom(txs, w.wallet, { max: 60 });
  const otherMints = buys.buys.filter((b) => b.mint !== ctx.mint);
  const sellAt = firstSell(txs, w.wallet, ctx.mint, ctx.createdAt);
  const dests = sentTo(txs, w.wallet, sellAt ?? ctx.createdAt);
  const signals = [];
  const add = (key, weight, ok, text) => signals.push({ key, weight, ok, text });

  // financement
  if (fund) {
    const ago = ctx.createdAt - fund.at;
    if (fund.funder === ctx.dev) add('fundDev', 2, true, `Financé par le dev (${fr(fund.sol, 3)} SOL)`);
    else if (ctx.devFunder && fund.funder === ctx.devFunder && !fund.exchange) add('fundSame', 2, true, `Financé par la même source que le dev (${short(fund.funder)})`);
    else if (fund.exchange && sameExchange(fund.exchange, ctx.exchange) && ago <= EXSNIPE.fundHours * 3600) add('fundExchange', 2, true, `Retiré de ${fund.exchange} comme le dev, ${fmtDelay(ago)} avant le lancement (${fr(fund.sol)} SOL)`);
    else if (fund.exchange) add('fundOtherEx', 0.5, true, `Retiré de ${fund.exchange} (${fr(fund.sol)} SOL)`);
    else add('fundOther', 0, false, `Financé par ${short(fund.funder)}, sans lien avec le dev`);
  } else add('fundNone', 0, false, capped ? 'Financement trop ancien pour être lu (wallet très actif)' : 'Financement introuvable');
  // wallet neuf ?
  if (!capped && txBefore <= EXSNIPE.freshMax) add('fresh', 1, true, `Wallet neuf : ${txBefore} transaction${txBefore > 1 ? 's' : ''} avant le lancement`);
  else add('old', 0, false, capped ? `Wallet très actif (plus de ${EXSNIPE.walletTx} transactions)` : `${txBefore} transactions avant le lancement`);
  // bundle
  if (w.bundle) add('bundle', 0.5, true, 'Achète dans le même bloc que la création');
  else add('early', 0, true, `${w.rank}e acheteur, ${w.delay} s après la création`);
  // revend avec le rug
  if (sellAt != null && ctx.devSellAt != null && Math.abs(sellAt - ctx.devSellAt) <= EXSNIPE.rugSellSec) add('rugSell', 2, true, `Revend ${sellAt === ctx.devSellAt ? 'dans la même seconde que' : `${Math.abs(sellAt - ctx.devSellAt)} s ${sellAt > ctx.devSellAt ? 'après' : 'avant'}`} le dev`);
  else if (sellAt != null) add('sell', 0, false, `Revend ${ctx.devSellAt != null ? `${fmtDelay(Math.abs(sellAt - ctx.devSellAt))} ${sellAt > ctx.devSellAt ? 'après' : 'avant'} le dev` : `${fmtDelay(sellAt - ctx.createdAt)} après la création`}`);
  // l'argent revient
  const back = [...dests.keys()].filter((d) => d === ctx.dev || d === ctx.devFunder || ctx.devDests.has(d));
  if (back.length) add('moneyBack', 2, true, `Renvoie son SOL ${back[0] === ctx.dev ? 'au dev' : back[0] === ctx.devFunder ? 'à la source du dev' : `vers la même adresse que le dev (${short(back[0])})`}`);
  // sniper ?
  const sniper = txBefore >= EXSNIPE.sniperTx || buys.total >= EXSNIPE.sniperMints;
  if (sniper) add('sniper', -3, false, buys.total >= EXSNIPE.sniperMints ? `Achète beaucoup de tokens différents (${buys.total}) : profil de sniper` : 'Beaucoup d’activité avant le lancement : profil de sniper');

  const { score, verdict } = scoreSignals(signals);
  return {
    wallet: w.wallet, rank: w.rank, delay: w.delay, bundle: !!w.bundle, verdict, score, signals,
    txBefore, capped, funding: fund, sellAt, dests: [...dests.keys()].slice(0, 6), otherBuys: otherMints.slice(0, 30), buysTotal: buys.total,
  };
}

/** Score d'un wallet du bundle : à lui avec 3 points (deux indices forts, ou un fort + neuf + bundle), sniper sinon. */
export function scoreSignals(signals) {
  const score = signals.reduce((n, s) => n + (s.ok ? s.weight : s.weight < 0 ? s.weight : 0), 0);
  const strong = signals.filter((s) => s.ok && s.weight >= 2).length;
  const sniper = signals.some((s) => s.key === 'sniper');
  const verdict = sniper && strong < 2 ? 'sniper' : score >= 3 ? 'mine' : score >= 1.5 ? 'doubt' : 'sniper';
  return { score, verdict };
}

function fmtDelay(s) {
  if (s == null) return '?';
  s = Math.abs(s);
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 360) / 10} h`.replace('.', ',');
  return `${Math.round(s / 8640) / 10} j`.replace('.', ',');
}

/** Regroupe des financements par montant exact (même exchange) : { name, sol, devs:[...] }. */
export function amountClusters(fundings) {
  const out = [];
  for (const f of fundings) {
    if (!f.name || GENERIC.has(f.name)) continue;
    let c = out.find((x) => x.name === f.name && sameAmount(x.sol, f.sol));
    if (!c) { c = { name: f.name, sol: f.sol, devs: [], hots: {} }; out.push(c); }
    if (!c.devs.some((d) => d.dev === f.dev)) c.devs.push(f);
    c.hots[f.hot] = (c.hots[f.hot] || 0) + 1;
  }
  return out.sort((a, b) => b.devs.length - a.devs.length);
}

/**
 * Verdict à partir de ce qui a été trouvé.
 * fundings : un par dev connu { dev, name, hot, sol, at, via } ; mine : wallets du bundle à lui ; reused : ceux qui reviennent sur ses tokens.
 */
export function exchangeVerdict({ exchange, hot, fundings, mine, reused, bundleAmounts }) {
  const clusters = amountClusters(fundings);
  const repeated = clusters.filter((c) => c.devs.length >= 2);
  const onEx = fundings.filter((f) => sameExchange(f.name, exchange));
  const devsOnEx = new Set(onEx.map((f) => f.dev)).size;
  const topHot = (c) => Object.entries(c.hots).sort((a, b) => b[1] - a[1])[0]?.[0] || hot;
  if (repeated.length) {
    const ranges = repeated.slice(0, 5).map((c) => ({ min: r4(c.sol - EXSNIPE.tol), max: r4(c.sol + EXSNIPE.tol), sol: c.sol, devs: c.devs.length, hot: topHot(c) }));
    const n = Math.max(...repeated.map((c) => c.devs.length));
    // montant rond (au centième près) : courant chez les clients de l'exchange, plus de faux achats
    const round = ranges.filter((r) => Math.abs(r.sol * 100 - Math.round(r.sol * 100)) < 0.005);
    const mainHot = ranges[0].hot;
    const otherHots = [...new Set(ranges.map((r) => r.hot).filter((h) => h !== mainHot))];
    return {
      status: 'confirmed', title: 'Schéma exchange confirmé',
      summary: `${n} devs ont été retirés de ${exchange} avec le même montant exact : ${ranges.map((r) => `${fr(r.sol)} SOL`).join(', ')}. Le bot suit ${exchange} et achète dès qu'un wallet neuf reçoit ce montant puis lance.`,
      bot: {
        mode: "Modèle d'Échange", address: mainHot, addressName: exchange, otherHots, ranges,
        options: [
          { name: 'Portefeuille vierge uniquement', on: true, why: 'Ses devs sont toujours des wallets neufs : écarte les clients habituels de l’exchange.' },
          { name: 'Supprimer sans lancement', on: true, why: 'Un wallet qui reçoit le montant sans lancer est retiré tout seul.' },
          { name: 'Hériter paramètres', on: true, why: 'Tes réglages par défaut ont l’achat auto coupé : sans l’héritage, le dev ajouté n’achète rien.' },
        ],
        lossCounter: n >= 3 && !round.length ? '10 à 15' : '2 à 5',
        lossWhy: round.length ? 'Montant rond : le bot achètera aussi des clients qui ne sont pas à lui, coupe vite.' : n >= 3 ? `Rugger prouvé (${n} devs au même montant).` : 'Schéma vu deux fois seulement : coupe vite s’il dérape.',
        warning: round.length ? `${round.map((r) => `${fr(r.sol)} SOL`).join(', ')} : montant rond, beaucoup de clients de ${exchange} retirent ce montant. Garde Portefeuille vierge uniquement et Supprimer sans lancement, et un compteur de pertes bas.` : null,
      },
      ranges,
    };
  }
  const reuse = reused.find((r) => r.tokens >= 2);
  if (reuse) {
    return {
      status: 'selfsnipe', title: 'Il s’auto-snipe avec le même wallet',
      summary: `Son montant change d'un dev à l'autre, mais son wallet ${short(reuse.wallet)} achète ses tokens à leur naissance (${reuse.tokens} tokens). En copytrade, le bot achète dans le même bloc que lui.`,
      bot: {
        mode: 'Copytrade (Track Buys)', address: reuse.wallet, addressName: 'Son wallet de bundle',
        options: [
          { name: 'Achat unique', on: true, why: 'Un seul achat par token. Quand le bot demande « L’appliquer sur tout ce wallet ? », réponds OUI.' },
        ],
        tp: '+100 % à +200 %',
        lossCounter: '2 à 5', lossWhy: 'Copie d’un wallet : coupe vite si ses achats deviennent perdants.',
      },
    };
  }
  if (devsOnEx >= 2) {
    const amts = [...new Set(onEx.map((f) => r4(f.sol)))];
    return {
      status: 'variable', title: 'Même exchange, montant qui change',
      summary: `${devsOnEx} de ses devs sortent de ${exchange}, mais jamais avec le même montant (${amts.map((a) => fr(a)).join(', ')} SOL). Une plage exacte ne le rattrapera pas : la surveillance guette ces montants et ceux de son bundle.`,
    };
  }
  return {
    status: 'watch', title: 'À surveiller',
    summary: `Son dev a été retiré de ${exchange}, mais ce montant n'est pas encore revenu chez un autre dev. La surveillance relit ${exchange} toutes les 3 min${bundleAmounts.length ? ', avec aussi les montants de son bundle' : ''} : dès qu'un wallet neuf le reçoit, tu es prévenu.`,
  };
}

export async function exchangeDossier(inv, rpc, emit = () => {}, { history = [], now = Math.floor(Date.now() / 1000) } = {}) {
  const log = (msg) => emit({ type: 'log', msg });
  if (!rpc.windowTxs) throw new Error('Il faut la clé Helius pour le dossier exchange.');
  const dev = inv.start;
  const devTokens = [...(inv.tokens || [])].filter((t) => t.creator === dev && t.mint && t.createdAt).sort((a, b) => b.createdAt - a.createdAt);
  const coin = devTokens.find((t) => t.mint === inv.fromToken?.mint) || devTokens[0] || null;
  const createdAt = coin?.createdAt ?? null;

  // ---------- 1. financement du dev ----------
  log(`Financement de ${short(dev)}`);
  const devAll = await rpc.windowTxs(dev, 0, now + 60, 400, 'asc', null, false).catch(() => null);
  const devTxs = devAll?.txs || [];
  const firstCreate = Math.min(...devTokens.map((t) => t.createdAt), createdAt ?? Infinity);
  const direct = withdrawalsFrom(devTxs, dev, Number.isFinite(firstCreate) ? firstCreate + 1 : undefined);
  const fps0 = (inv.fingerprints || []).filter((f) => f.kind === 'exchange');
  // pas de retrait direct : l'exchange est plus haut dans sa chaîne (l'argent est passé par des relais) ; on garde son montant
  const withdrawals = direct.length ? direct : fps0.map((f) => ({ hot: f.source, name: f.name, sol: f.sol, at: null, upstream: true }));
  const devFund = fundingFrom(devTxs, dev, Number.isFinite(firstCreate) ? firstCreate + 1 : undefined);
  const fps = (inv.fingerprints || []).filter((f) => f.kind === 'exchange' || f.kind === 'hot');
  const main = withdrawals.slice().sort((a, b) => b.sol - a.sol)[0] || (fps[0] ? { hot: fps[0].source, name: fps[0].kind === 'hot' ? 'Exchange sans nom' : fps[0].name, sol: fps[0].sol, at: null } : null);
  if (!main) {
    return {
      start: dev, kind: 'not-exchange', createdAt: Date.now(), inv: inv.id, symbol: coin?.symbol || null,
      verdict: { status: 'not-exchange', title: 'Pas un rugger exchange', summary: `Son dev n'a pas été retiré d'un exchange connu${devFund ? ` : il a reçu ${fr(devFund.sol, 3)} SOL de ${short(devFund.funder)}` : ''}. Utilise la Traque classique pour ce schéma.` },
    };
  }
  const exchange = main.name;

  // ---------- 2. même montant ailleurs ----------
  const fundings = [];
  const pushF = (f) => { if (f.dev && f.sol && !fundings.some((x) => x.dev === f.dev && sameAmount(x.sol, f.sol))) fundings.push(f); };
  for (const w of withdrawals) pushF({ dev, name: w.name, hot: w.hot, sol: w.sol, at: w.at, via: w.upstream ? 'chain' : 'dev', symbol: coin?.symbol || null });
  // la traque : autres créateurs reçus au même montant (72 h, tous les hot wallets de l'exchange)
  for (const l of (inv.leads || []).filter((x) => x.type === 'fingerprint' && (x.status === 'created' || x.status === 'cluster'))) {
    pushF({ dev: l.end || l.address, name: exName(l.hot) || exchange, hot: l.hot, sol: l.sol, at: l.time, via: 'trace', symbol: l.creates?.[0]?.symbol || null, mint: l.creates?.[0]?.mint || null });
  }
  // tes enquêtes passées
  const hotNames = new Map(Object.entries(LABELS).filter(([, l]) => l.type === 'exchange').map(([a, l]) => [a, l.name]));
  for (const h of history) {
    if (h.dev === dev || !h.sol) continue;
    const nm = hotNames.get(h.source);
    if (!sameExchange(nm, exchange)) continue;
    if (withdrawals.some((w) => sameAmount(w.sol, h.sol))) pushF({ dev: h.dev, name: nm, hot: h.source, sol: h.sol, at: null, via: 'history', inv: h.inv });
  }
  log(`${withdrawals.length} retrait${withdrawals.length > 1 ? 's' : ''} de ${exchange} avant le lancement, ${fundings.filter((f) => f.dev !== dev).length} autre${fundings.filter((f) => f.dev !== dev).length > 1 ? 's' : ''} dev au même montant`);

  // ---------- 3. son bundle ----------
  let bundle = [];
  let devSell = null;
  const mintTxs = [];
  if (coin) {
    log(`Bundle et premiers acheteurs de ${coin.symbol || short(coin.mint)}`);
    const r = await rpc.windowTxs(coin.mint, coin.createdAt - 2, coin.createdAt + 3600, 3000, 'asc', null, false).catch(() => null);
    mintTxs.push(...(r?.txs || []));
    const eb = earlyBuyersFrom(mintTxs, coin.mint, dev, { first: 20 });
    const known = new Set([dev, ...fundings.map((f) => f.dev)]);
    const picks = rugWallets(eb.buyers.filter((b) => !known.has(b.wallet)), { firstBuyers: EXSNIPE.firstBuyers, maxBundle: EXSNIPE.maxBundle });
    devSell = firstSell(mintTxs, dev, coin.mint, coin.createdAt);
    const devDests = new Set(sentTo(devTxs, dev, coin.createdAt).keys()); // où le dev renvoie son SOL après le lancement
    const ctx = { dev, devFunder: devFund?.funder || null, exchange, createdAt: coin.createdAt, mint: coin.mint, devSellAt: devSell, devDests };
    let i = 0;
    for (let k = 0; k < picks.length; k += 4) {
      const part = await Promise.all(picks.slice(k, k + 4).map(async (w) => {
        const wr = await rpc.windowTxs(w.wallet, 0, now + 60, EXSNIPE.walletTx, 'desc', null, false).catch(() => null);
        const txs = (wr?.txs || []).slice().sort((a, b) => a.time - b.time);
        return judgeBundleWallet(w, txs, !!wr?.capped, ctx);
      }));
      bundle.push(...part);
      i += part.length;
      log(`Wallets du bundle vérifiés : ${i} / ${picks.length}`);
    }
    // indices d'équipe, entre wallets du bundle (deux snipers qui vident au même endroit sont un même opérateur de snipe,
    // pas le dev : ces indices ne comptent que hors profil sniper)
    const destCount = new Map();
    const funderCount = new Map();
    for (const b of bundle) {
      for (const d of b.dests) destCount.set(d, (destCount.get(d) || 0) + 1);
      const f = b.funding?.funder;
      if (f && !b.funding.exchange && f !== dev) funderCount.set(f, (funderCount.get(f) || 0) + 1);
    }
    for (const b of bundle) {
      if (b.signals.some((x) => x.key === 'sniper')) continue;
      const shared = b.dests.find((d) => destCount.get(d) >= 2 && !labelOf(d));
      if (shared && !b.signals.some((x) => x.key === 'moneyBack')) b.signals.push({ key: 'collector', weight: 2, ok: true, text: `Renvoie son SOL vers ${short(shared)}, comme d’autres wallets du bundle` });
      const f = b.funding?.funder;
      if (f && funderCount.get(f) >= 2) {
        const i = b.signals.findIndex((x) => x.key === 'fundOther');
        const sig = { key: 'fundTeam', weight: 1, ok: true, text: `Financé par ${short(f)}, comme ${funderCount.get(f) - 1} autre${funderCount.get(f) > 2 ? 's' : ''} wallet${funderCount.get(f) > 2 ? 's' : ''} du bundle` };
        if (i >= 0) b.signals[i] = sig; else b.signals.push(sig);
      }
      Object.assign(b, scoreSignals(b.signals));
    }
  }
  const mine = bundle.filter((b) => b.verdict === 'mine');
  let collector = null;
  if (coin) {
    const cnt = new Map();
    const devOut = [...sentTo(devTxs, dev, coin.createdAt).keys()];
    for (const a of devOut) cnt.set(a, { dev: true, wallets: 0 });
    for (const b of mine) for (const a of b.dests) { const c = cnt.get(a) || { dev: false, wallets: 0 }; c.wallets++; cnt.set(a, c); }
    const best = [...cnt.entries()].filter(([a, c]) => !labelOf(a) && c.wallets + (c.dev ? 1 : 0) >= 2).sort((x, y) => (y[1].wallets + y[1].dev) - (x[1].wallets + x[1].dev))[0];
    if (best) collector = { address: best[0], dev: best[1].dev, wallets: best[1].wallets };
  }
  const bundleAmounts = mine.filter((b) => b.funding?.exchange && sameExchange(b.funding.exchange, exchange)).map((b) => ({ sol: b.funding.sol, hot: b.funding.funder, wallet: b.wallet }));
  log(`Bundle : ${mine.length} wallet${mine.length > 1 ? 's' : ''} à lui, ${bundle.filter((b) => b.verdict === 'sniper').length} sniper${bundle.filter((b) => b.verdict === 'sniper').length > 1 ? 's' : ''}, ${bundle.filter((b) => b.verdict === 'doubt').length} à confirmer`);

  // ---------- 4. ses autres tokens, par son bundle ----------
  const others = [];
  const seenMint = new Set(coin ? [coin.mint] : []);
  const reusedCount = new Map();
  const cand = [];
  for (const b of mine) for (const buy of b.otherBuys) if (!seenMint.has(buy.mint)) { seenMint.add(buy.mint); cand.push({ ...buy, wallet: b.wallet }); }
  cand.sort((a, b) => b.time - a.time);
  for (const c of cand.slice(0, EXSNIPE.maxOtherTokens)) {
    const first = await rpc.windowTxs(c.mint, 0, c.time + 1, 5, 'asc', null, false).catch(() => null);
    const cr = first?.txs.find((t) => t.create?.mint === c.mint);
    if (!cr) continue;
    const atBirth = c.time - cr.time <= EXSNIPE.selfSnipeSec;
    if (!atBirth) continue; // acheté plus tard : pas forcément à lui
    const creator = cr.feePayer;
    const ct = await rpc.windowTxs(creator, 0, cr.time + 1, 60, 'asc', null, false).catch(() => null);
    const f = fundingFrom(ct?.txs || [], creator, cr.time + 1);
    const ws = withdrawalsFrom(ct?.txs || [], creator, cr.time + 1);
    const ex = ws.sort((a, b) => b.sol - a.sol)[0] || null;
    reusedCount.set(c.wallet, (reusedCount.get(c.wallet) || 1) + 1);
    const tok = { mint: c.mint, symbol: cr.create.symbol || null, name: cr.create.name || null, createdAt: cr.time, creator, wallet: c.wallet, funding: f, exchange: ex?.name || null, hot: ex?.hot || null, sol: ex?.sol ?? f?.sol ?? null };
    tok.match = ex && sameExchange(ex.name, exchange) ? (withdrawals.some((w) => sameAmount(w.sol, ex.sol)) ? 'amount' : 'exchange') : 'none';
    others.push(tok);
    for (const w of ws) pushF({ dev: creator, name: w.name, hot: w.hot, sol: w.sol, at: w.at, via: 'bundle', symbol: tok.symbol, mint: c.mint });
  }
  if (cand.length) log(`Ses autres tokens trouvés par son bundle : ${others.length}`);
  const reused = [...reusedCount.entries()].map(([wallet, tokens]) => ({ wallet, tokens })).sort((a, b) => b.tokens - a.tokens);

  // ---------- 5. verdict ----------
  const verdict = exchangeVerdict({ exchange, hot: main.hot, fundings, mine, reused, bundleAmounts });
  const delay = direct.length && createdAt ? createdAt - direct[direct.length - 1].at : null;
  return {
    start: dev, kind: 'exchange', createdAt: Date.now(), inv: inv.id, symbol: coin?.symbol || null, coin: coin ? { mint: coin.mint, symbol: coin.symbol, createdAt: coin.createdAt } : null,
    exchange, hot: main.hot, withdrawals, upstream: !direct.length, delay, devFund, devSellAt: devSell, devTokens: devTokens.length,
    fingerprints: fps.map((f) => ({ name: f.name, source: f.source, sol: f.sol, windowHours: f.windowHours, coveredHours: f.coveredHours, txRead: f.txRead, sends: f.sends, creators: f.creators, bySource: f.bySource || [] })),
    fundings, clusters: amountClusters(fundings), bundle, mine: mine.map((b) => b.wallet), collector, bundleAmounts, others, reused, verdict,
    watchAmounts: [...withdrawals.map((w) => ({ sol: w.sol, hot: w.hot, kind: 'dev' })), ...bundleAmounts.map((b) => ({ sol: b.sol, hot: b.hot, kind: 'bundle' }))],
  };
}
