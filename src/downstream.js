import { labelOf } from './labels.js';

const SOL = 1e9;
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '?');

export const FORWARD = {
  rapide: { maxNodes: 15, maxDepth: 2, fanout: 6, txPerNode: 80 },
  normal: { maxNodes: 40, maxDepth: 3, fanout: 10, txPerNode: 200 },
  profond: { maxNodes: 100, maxDepth: 4, fanout: 20, txPerNode: 400 },
};

/**
 * Suit l'argent qui sort d'un wallet, dans l'ordre du temps.
 * - relais : reçoit et renvoie presque tout aussitôt (on le traverse sans compter de niveau) ;
 * - wallet central : distribue à beaucoup de wallets neufs (on suit les plus gros envois) ;
 * - exchange ou service : on s'arrête.
 * En chemin, relève les tokens créés et les tokens achetés par les wallets financés.
 */
export async function followForward(start, rpc, sigs, opts = {}, log = () => {}) {
  const o = { ...FORWARD.normal, minSol: 0.3, ...opts };
  const nodes = new Map();
  const edges = [];
  const creates = [];
  const buys = new Map(); // mint -> { mint, buyers: Set, firstAt, sol }
  const queue = [{ address: start, since: 0, depth: 0, parent: null, inLamports: 0, inAt: null }];
  let done = 0;
  while (queue.length && nodes.size < o.maxNodes) {
    const q = queue.shift();
    if (nodes.has(q.address)) continue;
    const node = { address: q.address, parent: q.parent, depth: q.depth, inSol: q.inLamports / SOL, inAt: q.inAt, kind: 'wallet', txCount: 0, outCount: 0, creates: [] };
    nodes.set(q.address, node);
    const lab = labelOf(q.address);
    if (lab) { node.kind = lab.type === 'exchange' ? 'exchange' : 'service'; node.label = lab.name; continue; }
    const s = await sigs(q.address, 1);
    node.txCount = s.list.length;
    Object.assign(node, activity(s.list, !s.complete));
    if (!s.complete) { node.kind = 'busy'; continue; } // plus de 1 000 transactions : exchange, bot ou service
    // dans l'ordre du temps, par paquets : on s'arrête dès que l'argent reçu est reparti
    // (un wallet de collecte reçoit souvent des dizaines de transferts juste avant de tout renvoyer)
    // Les rafales (des centaines de transactions dans la même seconde : balayage de ses wallets) passent en dernier :
    // le gros envoi qui suit est presque toujours seul dans sa seconde.
    const win = s.list.filter((x) => !x.err && (x.time ?? 0) >= q.since - 2);
    const perSec = new Map();
    for (const x of win) perSec.set(x.time, (perSec.get(x.time) || 0) + 1);
    const after = win.sort((a, b) => Math.min(perSec.get(a.time), 10) - Math.min(perSec.get(b.time), 10) || (a.time ?? 0) - (b.time ?? 0)).slice(0, o.txPerNode);
    const txs = [];
    let outSum = 0;
    await rpc.prefetch?.(q.address, after.slice(0, 120));
    for (let i = 0; i < after.length; i += 40) {
      const part = (await Promise.all(after.slice(i, i + 40).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
      txs.push(...part);
      for (const t of part) for (const tr of outMoves(t, q.address)) if (tr.from === q.address && tr.to !== q.address) outSum += tr.lamports;
      if (q.inLamports && outSum >= 0.8 * q.inLamports) break;
    }
    done++;

    // tokens créés par ce wallet, avec ce qu'il y a gagné
    for (const t of txs) {
      if (!t.create || !t.signers.includes(q.address)) continue;
      const mint = t.create.mint;
      let bought = 0; let sold = 0; let lastSell = null;
      for (const x of txs) {
        if (!x.tokenDelta.some((d) => d.owner === q.address && d.mint === mint)) continue;
        const d = x.solDelta[q.address] || 0;
        if (d < 0) bought += -d; else { sold += d; lastSell = x.time; }
      }
      // frais de créateur réclamés après la création
      const fees = txs.filter((x) => x.pump && !x.create && (x.time ?? 0) >= (t.time ?? 0) && x.signers.includes(q.address) && !x.tokenDelta.some((d) => d.owner === q.address) && (x.solDelta[q.address] || 0) > 1e6).reduce((s2, x) => s2 + x.solDelta[q.address], 0);
      creates.push({ mint, name: t.create.name, symbol: t.create.symbol, uri: t.create.uri, creator: q.address, createdAt: t.time, createSig: t.sig, boughtSol: bought / SOL, soldSol: sold / SOL, creatorFeesSol: fees / SOL, lastSellAt: lastSell });
      node.creates.push(mint);
    }
    // tokens achetés : plusieurs wallets financés par la même source qui achètent le même token = achats groupés du dev
    for (const t of txs) {
      if (!t.pump || t.create) continue;
      for (const d of t.tokenDelta) {
        if (d.owner !== q.address || d.delta <= 0) continue;
        const b = buys.get(d.mint) || { mint: d.mint, buyers: new Set(), firstAt: t.time, sol: 0 };
        b.buyers.add(q.address);
        b.firstAt = Math.min(b.firstAt ?? t.time, t.time ?? b.firstAt);
        b.sol += Math.max(0, -(t.solDelta[q.address] || 0)) / SOL;
        buys.set(d.mint, b);
      }
    }

    // sorties de SOL (hors achats pump.fun)
    const outMap = new Map();
    for (const t of txs) {
      for (const tr of outMoves(t, q.address)) {
        if (tr.from !== q.address || tr.to === q.address || tr.lamports < o.minSol * SOL) continue;
        if (labelOf(tr.to)?.type === 'infra') continue;
        const cur = outMap.get(tr.to) || { to: tr.to, lamports: 0, time: t.time, sig: t.sig };
        cur.lamports += tr.lamports;
        outMap.set(tr.to, cur);
      }
    }
    const outs = [...outMap.values()].sort((a, b) => b.lamports - a.lamports);
    node.outCount = outs.length;
    const relay = node.txCount <= 4 && outs.length === 1 && q.inLamports > 0 && outs[0].lamports >= 0.9 * q.inLamports && (outs[0].time - (q.inAt ?? outs[0].time)) <= 120;
    node.kind = relay ? 'relay' : outs.length >= 6 ? 'hub' : 'wallet';
    for (const x of outs) edges.push({ from: q.address, to: x.to, lamports: x.lamports, time: x.time, sig: x.sig, side: 'after' });
    const childDepth = relay ? q.depth : q.depth + 1;
    if (q.address !== start && childDepth > o.maxDepth) continue;
    for (const x of outs.slice(0, o.fanout)) {
      if (!nodes.has(x.to)) queue.push({ address: x.to, since: x.time ?? 0, depth: childDepth, parent: q.address, inLamports: x.lamports, inAt: x.time });
    }
    if (done % 5 === 0) log(`Après : ${nodes.size} wallets suivis, ${creates.length} token${creates.length > 1 ? 's' : ''} créé${creates.length > 1 ? 's' : ''} trouvé${creates.length > 1 ? 's' : ''}`);
  }
  // achats groupés : au moins 3 wallets du chemin sur le même token
  const groupBuys = [...buys.values()].filter((b) => b.buyers.size >= 3).map((b) => ({ mint: b.mint, buyers: [...b.buyers], firstAt: b.firstAt, sol: b.sol }));
  return { nodes: [...nodes.values()], edges, creates, groupBuys, truncated: queue.length > 0 };
}

// Chemin depuis le départ jusqu'à un wallet, en remontant les parents.
export function pathTo(nodes, address) {
  const by = new Map(nodes.map((n) => [n.address, n]));
  const path = [];
  let cur = by.get(address);
  while (cur) { path.unshift(cur); cur = cur.parent ? by.get(cur.parent) : null; }
  return path;
}

export { short as shortAddr };

/**
 * Activité d'un wallet dans le temps : rafales séparées de plus de 10 minutes.
 * Un wallet « jetable » fait tout en une seule rafale puis ne sert plus jamais.
 * Un wallet « réutilisé » revient à chaque cycle (rafales sur plusieurs heures) : lui seul vaut un tracker durable.
 */
export function activity(list, partial = false) {
  const times = list.map((x) => x.time).filter(Boolean).sort((a, b) => a - b);
  let bursts = 0; let prev = null;
  for (const t of times) { if (prev == null || t - prev > 600) bursts++; prev = t; }
  const firstAt = times[0] ?? null;
  const lastAt = times[times.length - 1] ?? null;
  const reused = bursts >= 2 && lastAt - firstAt >= 3600;
  return { bursts, firstAt, lastAt, reused, partialHistory: partial };
}

/**
 * Le gros de l'argent, de wallet en wallet, sans limite de niveaux : on suit chaque fois le plus gros envoi
 * jusqu'à ce que l'argent s'arrête (wallet qui garde le SOL), arrive sur un exchange ou soit éparpillé.
 * Résultat : le chemin, et l'endroit où est l'argent maintenant.
 */
export async function followMainFlow(start, rpc, sigs, opts = {}, log = () => {}) {
  const o = { maxHops: 60, txCap: 120, minShare: 0.3, ...opts };
  log(`Chemin de l'argent : on suit le gros de son SOL jusqu'à là où il est maintenant`);
  const path = [];
  let cur = { address: start, since: 0, inLamports: 0, inAt: null };
  let end = 'unknown';
  const seen = new Map(); // adresse -> nombre de passages (boucles « aller-retour » des mélangeurs)
  for (let hop = 0; hop < o.maxHops; hop++) {
    seen.set(cur.address, (seen.get(cur.address) || 0) + 1);
    if (seen.get(cur.address) > 3) { end = 'mixer'; break; }
    const lab = labelOf(cur.address);
    const step = { address: cur.address, inSol: cur.inLamports / SOL, inAt: cur.inAt, kind: 'wallet' };
    path.push(step);
    if (lab) { step.kind = lab.type === 'exchange' ? 'exchange' : 'service'; step.label = lab.name; end = 'exchange'; break; }
    const s = await sigs(cur.address, 1);
    step.txCount = s.list.length;
    Object.assign(step, activity(s.list, !s.complete));
    // wallet très actif depuis longtemps (pas une rafale) : exchange ou service, on s'arrête
    if (s.list.length >= 1000 && step.lastAt - step.firstAt > 6 * 3600) { step.kind = 'busy'; end = 'exchange'; break; }
    // plus de 1 000 transactions et encore du SOL dessus : wallet d'un service (paiement, swap, mélange) qui tourne,
    // pas un wallet du dev. L'argent en ressortira par un autre wallet du service.
    if (s.list.length >= 1000 && cur.address !== start) {
      const b2 = (await rpc.balances([cur.address]).catch(() => ({})))[cur.address] || 0;
      if (b2 >= 1e9) { step.kind = 'service'; step.balanceSol = b2 / SOL; end = 'service'; break; }
    }
    // seulement ce qui se passe après l'arrivée de l'argent (même seconde comprise)
    const win = s.list.filter((x) => !x.err && (x.time ?? 0) >= cur.since);
    // d'abord la fin de la rafale (le reste de l'argent part souvent en dernier), puis les secondes calmes
    const perSec = new Map();
    for (const x of win) perSec.set(x.time, (perSec.get(x.time) || 0) + 1);
    const newest = win.slice(0, 20);
    const rest = win.slice(20).sort((a, b) => Math.min(perSec.get(a.time), 10) - Math.min(perSec.get(b.time), 10) || (a.time ?? 0) - (b.time ?? 0));
    const order = [...newest, ...rest].slice(0, o.txCap);
    const outs = new Map();
    let best = null;
    await rpc.prefetch?.(cur.address, order.slice(0, 120));
    for (let i = 0; i < order.length; i += 40) {
      const part = (await Promise.all(order.slice(i, i + 40).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
      for (const t of part) {
        if ((t.time ?? 0) < cur.since - 2) continue;
        if (t.create && t.signers.includes(cur.address) && !(step.creates || []).some((c) => c.mint === t.create.mint)) {
          (step.creates ||= []).push({ mint: t.create.mint, name: t.create.name, symbol: t.create.symbol, uri: t.create.uri, creator: cur.address, createdAt: t.time, createSig: t.sig });
        }
        for (const tr of outMoves(t, cur.address, { hidden: true })) {
          if (tr.from !== cur.address || tr.to === cur.address || labelOf(tr.to)?.type === 'infra') continue;
          const x = outs.get(tr.to) || { to: tr.to, lamports: 0, time: t.time };
          x.lamports += tr.lamports;
          x.time = Math.min(x.time ?? t.time, t.time ?? x.time);
          outs.set(tr.to, x);
          if (!best || x.lamports > best.lamports) best = x;
        }
      }
      if (best && cur.inLamports && best.lamports >= 0.5 * cur.inLamports) break;
    }
    // parmi les plus gros envois, le premier dans le temps : c'est lui qui emporte l'argent qui vient d'arriver
    if (best) best = [...outs.values()].filter((x) => x.lamports >= 0.9 * best.lamports).sort((a, b) => (a.time ?? 0) - (b.time ?? 0))[0];
    step.outCount = outs.size;
    step.kind = step.txCount <= 4 && best && cur.inLamports && best.lamports >= 0.9 * cur.inLamports ? 'relay' : outs.size >= 6 || step.txCount >= 300 ? 'hub' : 'wallet';
    // mélangeur : plusieurs wallets jetables à centaines de transactions, en une seule rafale, qui mêlent son argent à d'autres
    const mixers = path.filter((x) => x.kind === 'hub' && x.txCount >= 300 && x.bursts === 1).length;
    if (mixers >= 3) { end = 'mixer'; break; }
    const ref = cur.inLamports || (best?.lamports ?? 0);
    if (!best || best.lamports < 0.05 * SOL) { end = outs.size >= 6 ? 'split' : 'rest'; break; }
    if (cur.inLamports && best.lamports < o.minShare * cur.inLamports) { end = outs.size >= 6 ? 'split' : 'rest'; break; }
    step.outSol = best.lamports / SOL;
    step.outAt = best.time;
    // il ressort nettement plus (ou moins) que ce qui est entré : son argent a été mêlé à d'autres fonds
    if (cur.inLamports && (best.lamports > 1.3 * cur.inLamports || (step.kind === 'hub' && best.lamports < 0.7 * cur.inLamports))) step.merged = true;
    if (hop % 10 === 9) log(`Chemin de l'argent : ${hop + 1} wallets, ${(best.lamports / SOL).toFixed(1)} SOL`);
    cur = { address: best.to, since: best.time ?? cur.since, inLamports: best.lamports, inAt: best.time };
    void ref;
    if (seen.has(best.to)) step.loop = true; // l'argent revient sur un wallet déjà vu : aller-retour de mélange
  }
  const last = path[path.length - 1];
  const bal = (await rpc.balances([last.address]).catch(() => ({})))[last.address] || 0;
  last.balanceSol = bal / SOL;
  if (end === 'unknown') end = 'max';
  if (end === 'rest' && last.balanceSol < 0.5 * (last.inSol || 1)) end = last.outCount >= 6 ? 'split' : 'spent';
  // le dernier wallet vient de lancer son token avec l'argent : il est en plein cycle, l'argent reviendra par la vente
  if (['spent', 'rest'].includes(end) && last.creates?.length && last.address !== start) end = 'launched';
  const creates = path.filter((p) => p.address !== start).flatMap((p) => p.creates || []);
  return { path, end, frontier: last, creates };
}

/**
 * Mouvements cachés : certains programmes déplacent le SOL sans transfert visible (compte créé puis vidé
 * par le programme dans la même transaction). On les retrouve par les variations de solde :
 * si le wallet a reçu puis tout perdu, ou perdu du SOL sans transfert qui l'explique,
 * le SOL est parti vers le compte qui gagne le plus dans la transaction.
 */
/**
 * Les envois de SOL d'un wallet dans une transaction.
 * Dans une transaction pump.fun, on ne garde que les virements directs (au premier niveau) vers un compte qui garde
 * le SOL et qui n'est pas la courbe : certains devs cachent l'envoi au wallet suivant dans un mini-achat pump.fun
 * pour casser la piste des trackers (vu le 17/11/2026 sur la chaîne de BegCat : 30 SOL passés ainsi au dev suivant).
 */
export function outMoves(t, address, { hidden = false } = {}) {
  if (!t.pump) return hidden ? [...t.transfers, ...hiddenMoves(t, address)] : t.transfers;
  const curve = new Set(t.tokenDelta.filter((d) => d.delta < 0).map((d) => d.owner));
  return t.transfers.filter((x) => x.top && x.from === address && !curve.has(x.to) && (t.solDelta?.[x.to] || 0) >= 0.5 * x.lamports);
}

export function hiddenMoves(t, address) {
  const d = t.solDelta || {};
  const shown = t.transfers.filter((x) => x.from === address).reduce((s, x) => s + x.lamports, 0);
  const received = t.transfers.filter((x) => x.to === address).reduce((s, x) => s + x.lamports, 0);
  const lost = received - (d[address] || 0); // ce qui est ressorti du wallet dans cette transaction
  const missing = lost - shown;
  if (missing < 0.05 * 1e9) return [];
  let to = null; let best = 0;
  for (const [a, v] of Object.entries(d)) {
    if (a === address || v <= best || t.transfers.some((x) => x.from === a && x.to === address)) continue;
    to = a; best = v;
  }
  if (!to || best < 0.5 * missing) return [];
  return [{ from: address, to, lamports: Math.min(best, missing), hidden: true }];
}
