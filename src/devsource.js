/**
 * Source du dev : qui lui a envoyé le SOL avant son lancement, et est-ce traquable ?
 * Premier tri rapide (quelques lectures), avant la traque complète.
 *
 * Verdicts (couleur) :
 * - green  : exchange + montant exact déjà vu chez d'autres wallets ; wallet qui finance plusieurs wallets (mère probable) ;
 *            schéma araignée (la mère découpe une somme vers des wallets neufs qui renvoient tout au dev)
 * - amber  : exchange + montant pas encore répété ; wallet relais (il faut remonter) ; wallet inconnu
 * - red    : mélangeur / service (rafale de centaines de transactions) ; dev déjà très utilisé (pas jetable) ; source introuvable
 */
import { labelOf } from './labels.js';
import { activity } from './downstream.js';
import { detectSpider } from './spider.js';

const SOL = 1e9;
const HOT_SOL = 300;

async function oldestTxs(rpc, address, n = 12) {
  const page = await rpc.sigsPage(address, undefined, 1000).catch(() => []);
  const ok = page.filter((x) => !x.err);
  const txs = (await Promise.all(ok.slice(-n).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
  return { page, ok, txs: txs.sort((a, b) => (a.time || 0) - (b.time || 0)) };
}

/**
 * Le financement du dev avant son lancement : le plus gros SOL reçu (virement, ou SOL déplacé par un programme :
 * on prend alors celui qui a payé la transaction), parmi ses toutes premières transactions.
 */
function firstFunding(txs, address, before) {
  let best = null;
  for (const t of txs) {
    if (before && t.time > before) break;
    const tr = t.transfers.filter((x) => x.to === address && x.from !== address && x.lamports >= 0.05 * SOL).sort((a, b) => b.lamports - a.lamports)[0];
    let cand = tr ? { funder: tr.from, sol: tr.lamports / SOL, at: t.time } : null;
    if (!cand && t.feePayer && t.feePayer !== address && (t.solDelta?.[address] || 0) >= 0.05 * SOL) cand = { funder: t.feePayer, sol: t.solDelta[address] / SOL, at: t.time, hidden: true };
    if (cand && (!best || cand.sol > best.sol)) best = cand;
  }
  return best;
}

/** Combien d'autres wallets ont reçu ce même montant exact (±0,0001 SOL) de cet exchange, dans les 24 h autour. */
async function sameAmountCount(rpc, exchange, sol, at, exclude) {
  if (!rpc.windowTxs) return null;
  const r = await rpc.windowTxs(exchange, at - 12 * 3600, at + 12 * 3600, 1000, 'desc').catch(() => null);
  if (!r) return null;
  const to = new Set();
  for (const t of r.txs) for (const tr of t.transfers) if (tr.from === exchange && tr.to !== exclude && Math.abs(tr.lamports / SOL - sol) <= 0.0001) to.add(tr.to);
  return to.size;
}

export async function devSource(rpc, creator, createdAt, { balances = null } = {}) {
  const dev = await oldestTxs(rpc, creator, 25);
  if (dev.page.length >= 1000) return { color: 'red', kind: 'old-dev', text: 'Wallet du dev déjà très utilisé (plus de 1 000 transactions) : pas un dev jetable' };
  const sp = await detectSpider(rpc, creator, createdAt, undefined, dev.txs).catch(() => null);
  if (sp) return { color: sp.kind === 'mother' || sp.kind === 'exchange' ? 'green' : 'amber', kind: 'spider', spiderKind: sp.kind, funder: sp.mother, sol: sp.total, at: sp.at, legs: sp.legs.length, text: `Schéma araignée : ${sp.legs.length} wallets neufs × ${sp.legSol.toFixed(4)} SOL${sp.depth > 1 ? ` (via ${sp.depth} wallets jetables)` : ''}, tout part de ${sp.mother.slice(0, 4)}…${sp.mother.slice(-4)} (la mère, à tracker)` };
  const f = firstFunding(dev.txs, creator, createdAt);
  if (!f) return { color: 'red', kind: 'unknown', text: 'Source introuvable (pas de SOL reçu avant le lancement)' };
  const base = { funder: f.funder, sol: f.sol, at: f.at };
  const lab = labelOf(f.funder);
  const exchangeCheck = async (name) => {
    const n = await sameAmountCount(rpc, f.funder, f.sol, f.at, creator);
    if (n != null && n >= 1) return { ...base, color: name === 'Exchange sans nom' ? 'amber' : 'green', kind: 'exchange-repeat', name, repeats: n, text: `${name}, ${f.sol.toFixed(4)} SOL : même montant exact chez ${n} autre${n > 1 ? 's' : ''} wallet${n > 1 ? 's' : ''}${name === 'Exchange sans nom' ? ' (exchange à confirmer sur Solscan)' : ''}` };
    return { ...base, color: 'amber', kind: 'exchange-new', name, repeats: n ?? 0, text: `${name}, ${f.sol.toFixed(4)} SOL : montant pas encore répété (à surveiller)` };
  };
  if (lab?.type === 'exchange') return exchangeCheck(lab.name);
  if (lab) return { ...base, color: 'red', kind: 'service', name: lab.name, text: `${lab.name} (${lab.type}) : pas une source fixe` };
  // wallet sans nom : exchange sans nom, mélangeur, relais, mère ?
  const fw = await oldestTxs(rpc, f.funder, 20);
  const n = fw.page.length;
  if (n >= 1000) {
    const act = activity(fw.page.map((x) => ({ time: x.blockTime ?? null })), true);
    let bal = 0;
    try { bal = ((balances ? await balances([f.funder]) : await rpc.balances([f.funder]))[f.funder] || 0) / SOL; } catch { bal = 0; }
    if (bal >= HOT_SOL) return exchangeCheck('Exchange sans nom');
    if (act.lastAt - act.firstAt < 3 * 3600) return { ...base, color: 'red', kind: 'mixer', text: `Mélangeur ou service (${n >= 1000 ? 'plus de 1 000' : n} transactions en rafale) : probablement pas traquable` };
    return { ...base, color: 'amber', kind: 'busy', text: `Wallet très actif (plus de 1 000 transactions) : à confirmer par la traque` };
  }
  // relais : quelques transactions, il a reçu puis tout renvoyé
  if (n <= 4) {
    const up = firstFunding(fw.txs, f.funder, f.at);
    return { ...base, color: 'amber', kind: 'relay', upstream: up?.funder || null, text: `Relais (${n} transactions)${up ? ` financé par ${up.funder.slice(0, 4)}…${up.funder.slice(-4)}` : ''} : la traque remontera` };
  }
  // combien d'autres wallets ce financeur a-t-il financés ?
  const recent = (await Promise.all(fw.ok.slice(0, 40).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
  const kids = new Set();
  for (const t of [...recent, ...fw.txs]) for (const tr of t.transfers) if (tr.from === f.funder && tr.to !== creator && tr.to !== f.funder && tr.lamports >= 0.05 * SOL && !labelOf(tr.to)) kids.add(tr.to);
  if (kids.size >= 2) return { ...base, color: 'green', kind: 'mother', kids: kids.size, text: `Wallet ${f.funder.slice(0, 4)}…${f.funder.slice(-4)}, ${f.sol.toFixed(2)} SOL : a financé ${kids.size} autres wallets (mère probable)` };
  return { ...base, color: 'amber', kind: 'wallet', kids: kids.size, text: `Wallet ${f.funder.slice(0, 4)}…${f.funder.slice(-4)}, ${f.sol.toFixed(2)} SOL : n’a pas financé d’autres wallets récemment` };
}
