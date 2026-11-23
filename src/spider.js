/**
 * Schéma araignée (expliqué par le user le 22/11/2026 ; option « Schéma araignée » de l'écran Protection du bot) :
 * un wallet mère découpe une somme (ex. 1 SOL) en parts égales vers une dizaine de wallets neufs (0,1 SOL chacun),
 * qui renvoient tous leur part vers un même wallet : le dev. Souvent fait par les utilisateurs de Proxima.
 *
 * Sur le dev, ça se voit ainsi : avant son lancement, il reçoit plusieurs petits montants presque identiques,
 * en peu de temps, venant de wallets différents, eux-mêmes neufs et financés par la même adresse.
 * On suit alors la mère, pas le dev jetable ni les pattes.
 */
import { labelOf } from './labels.js';
import { TOL } from './census.js';

const SOL = 1e9;
export const SPIDER = { minLegs: 3, windowSec: 900, spread: 0.25, maxLegTx: 15, maxLegs: 12, maxHops: 15 };

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Les envois reçus par `address` avant `before` (secondes), d'autres wallets, d'au moins `min` SOL. */
function incoming(txs, address, before, min = 0.01) {
  const out = [];
  for (const t of txs) {
    if (before && (t.time ?? 0) > before) continue;
    for (const tr of t.transfers) {
      if (tr.to !== address || tr.from === address || tr.lamports < min * SOL) continue;
      out.push({ from: tr.from, sol: tr.lamports / SOL, at: t.time ?? 0 });
    }
  }
  return out;
}

/**
 * Le groupe de pattes : le plus grand ensemble de wallets différents qui envoient chacun un montant proche
 * (±25 % de la médiane) au dev en moins de 15 minutes.
 */
export function legGroup(ins, o = SPIDER) {
  const byFrom = new Map();
  for (const x of ins) if (!labelOf(x.from) && !byFrom.has(x.from)) byFrom.set(x.from, x); // première part de chaque wallet
  const list = [...byFrom.values()].sort((a, b) => a.at - b.at);
  let best = [];
  for (let i = 0; i < list.length; i++) {
    const win = list.filter((x) => x.at >= list[i].at && x.at - list[i].at <= o.windowSec);
    const m = median(win.map((x) => x.sol));
    const same = win.filter((x) => Math.abs(x.sol - m) <= o.spread * m);
    if (same.length > best.length) best = same;
  }
  return best.length >= o.minLegs ? best : [];
}

async function txsOf(rpc, address, n) {
  const page = await rpc.sigsPage(address, undefined, 1000).catch(() => []);
  const ok = page.filter((x) => !x.err);
  const txs = (await Promise.all(ok.slice(-n).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
  return { count: page.length, txs: txs.sort((a, b) => (a.time || 0) - (b.time || 0)) };
}

/**
 * Cherche le schéma araignée sur un dev. `before` : son premier lancement (secondes).
 * Renvoie null, ou { mother, legs: [{ address, sol, momSol, at }], legSol, total, ranges, at }.
 */
export async function detectSpider(rpc, dev, before, o = SPIDER, devTxs = null) {
  const own = devTxs ? { txs: devTxs } : await txsOf(rpc, dev, 30);
  const legs = legGroup(incoming(own.txs, dev, before), o).slice(0, o.maxLegs);
  if (!legs.length) return null;
  // On remonte la toile en suivant à chaque fois le plus gros financeur, à travers les wallets jetables
  // (quelques transactions, vidés), jusqu'au premier wallet qui ne l'est pas : la mère. Vu le 22/11/2026 :
  // mère (400 transactions) → 1,0428 SOL → relais → toiles de 10 wallets qui se renvoient des parts croisées
  // → 10 pattes × 0,1042 SOL → dev (1,0424 SOL arrivés).
  const seen = new Set([dev]);
  const path = [];
  let cur = { address: legs[0].from, until: legs[0].at };
  for (let hop = 0; hop < o.maxHops; hop++) {
    seen.add(cur.address);
    const lab = labelOf(cur.address);
    const t = lab ? { count: Infinity, txs: [] } : await txsOf(rpc, cur.address, o.maxLegTx + 4);
    if (lab || t.count > o.maxLegTx) {
      // premier wallet qui n'est pas jetable : la mère (ou l'exchange d'où sort l'argent)
      if (!path.length) return null; // la patte elle-même n'est pas jetable : pas une araignée
      const edge = path[path.length - 1];
      return {
        mother: cur.address, label: lab?.name || null, kind: lab?.type === 'exchange' ? 'exchange' : t.count >= 1000 ? 'busy' : 'mother',
        depth: path.length, motherTx: t.count,
        legs: legs.map((l) => ({ address: l.from, sol: l.sol, at: l.at })),
        legSol: median(legs.map((l) => l.sol)), momSol: edge.sol, momSends: 1,
        total: legs.reduce((s, l) => s + l.sol, 0),
        ranges: [lab?.type === 'exchange' ? [edge.sol - TOL.exchange, edge.sol + TOL.exchange] : [edge.sol - TOL.mother(edge.sol), edge.sol + TOL.mother(edge.sol)]].map(([a, b]) => [Math.round(a * 1e4) / 1e4, Math.round(b * 1e4) / 1e4]),
        at: Math.min(...legs.map((l) => l.at)),
      };
    }
    const ins = incoming(t.txs, cur.address, cur.until, 0.002).filter((x) => !seen.has(x.from) && labelOf(x.from)?.type !== 'infra');
    const big = ins.sort((a, b) => b.sol - a.sol || b.at - a.at)[0];
    // plus de financeur visible : le haut de la toile est lui aussi un wallet jetable, la mère change à chaque fois
    if (!big) return path.length ? { mother: cur.address, label: null, kind: 'oneshot', depth: path.length, motherTx: t.count, legs: legs.map((l) => ({ address: l.from, sol: l.sol, at: l.at })), legSol: median(legs.map((l) => l.sol)), momSol: path[path.length - 1].sol, momSends: 1, total: legs.reduce((s, l) => s + l.sol, 0), ranges: [], at: Math.min(...legs.map((l) => l.at)) } : null;
    path.push({ from: big.from, to: cur.address, sol: big.sol, at: big.at });
    cur = { address: big.from, until: big.at };
  }
  return null;
}
