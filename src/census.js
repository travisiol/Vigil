// Recensement des sources : qui finance les devs, avec quels montants, et quels autres devs sortent de la même source.
// Règles F Project : la source réutilisable (exchange ou wallet mère) est le tracker, pas le dev jetable ;
// plages de ±0,0001 SOL pour un exchange, ±0,01 SOL pour un wallet mère (variations de frais), 5 plages au plus.
import { labelOf } from './labels.js';
import { hiddenMoves } from './downstream.js';

const SOL = 1e9;
// exchange : ±0,0001 SOL ; wallet mère : 3 % du montant, plafonné à ±0,01 SOL (une plage de ±0,01 autour de 0,02 SOL ne filtrerait rien)
export const TOL = { exchange: 0.0001, mother: (a) => Math.min(0.01, Math.max(0.0005, 0.03 * a)) };

/**
 * Regroupe des montants en plages : montants à moins de 2 × tol l'un de l'autre = même plage.
 * Rend au plus `max` plages, les plus utilisées d'abord, avec le nombre de devs couverts.
 */
export function buildRanges(amounts, tolIn, max = 5) {
  const tol = typeof tolIn === 'function' ? tolIn : () => tolIn;
  const list = amounts.filter((a) => a > 0).sort((a, b) => a - b);
  const groups = [];
  for (const a of list) {
    const g = groups[groups.length - 1];
    if (g && a - g.max <= tol(a) + tol(g.max)) { g.max = a; g.n++; } else groups.push({ min: a, max: a, n: 1 });
  }
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return groups
    .sort((a, b) => b.n - a.n || a.min - b.min)
    .slice(0, max)
    .map((g) => ({ min: r4(g.min - tol(g.min)), max: r4(g.max + tol(g.max)), n: g.n, amount: r4((g.min + g.max) / 2) }));
}

export const inRanges = (sol, ranges) => ranges.some((r) => sol >= r.min - 1e-9 && sol <= r.max + 1e-9);

/**
 * Pour chaque dev, remonte les relais (wallets à 4 transactions au plus) jusqu'à la vraie source.
 * @param creators  [{ address, funder, fundedSol, fundedAt }]
 * @param info      (address) => { funder, fundedSol, fundedAt, txCount } | null, ou une promesse
 */
export async function sourcesOf(creators, info, { maxRelays = 6 } = {}) {
  const bySource = new Map();
  const isDev = new Set(creators.map((c) => c.address)); // un dev n'est jamais un relais
  for (const c of creators) {
    if (!c.funder) continue;
    let src = c.funder; let amount = c.fundedSol; let at = c.fundedAt; const relays = [];
    for (let i = 0; i < maxRelays; i++) {
      if (labelOf(src) || isDev.has(src)) break;
      const w = await info(src);
      if (!w || !w.funder || w.txCount > 4 || (w.children ?? 0) >= 2) break; // pas un relais (trop actif, ou finance plusieurs wallets) : c'est la source
      relays.push(src);
      amount = w.fundedSol ?? amount;
      at = w.fundedAt ?? at;
      src = w.funder;
    }
    const s = bySource.get(src) || { source: src, label: labelOf(src)?.name || null, labelType: labelOf(src)?.type || null, devs: [] };
    if (!s.devs.some((d) => d.address === c.address)) s.devs.push({ address: c.address, amount, at, relays });
    bySource.set(src, s);
  }
  return [...bySource.values()].sort((a, b) => b.devs.length - a.devs.length);
}

/**
 * Relit les envois d'une source sur une fenêtre de temps, garde ceux qui tombent dans les plages,
 * puis suit chaque destinataire (relais compris) jusqu'à un créateur de token.
 * @returns { sends, followed, creators: [{ address, via, amount, at, creates }], hitRate }
 */
export async function scanSource(source, ranges, rpc, sigs, { from, to, cap = 3000, maxFollow = 40, maxHops = 6, known = new Set() } = {}, log = () => {}) {
  let txs = null;
  if (rpc.windowTxs) {
    try { const r = await rpc.windowTxs(source, from, to, cap, 'desc'); txs = r?.txs || null; } catch { txs = null; }
  }
  if (!txs) {
    const s = await sigs(source, 1);
    const pick = s.list.filter((x) => !x.err && x.time >= from && x.time <= to).slice(0, Math.min(cap, 300));
    txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
  }
  const sends = [];
  for (const t of txs) {
    for (const tr of t.transfers) {
      if (tr.from !== source || tr.to === source) continue;
      // dans une transaction pump.fun, les achats passent par des virements internes ; un virement direct (premier niveau) reste un envoi
      if (t.pump && !tr.top) continue;
      const sol = tr.lamports / SOL;
      if (inRanges(sol, ranges)) sends.push({ to: tr.to, sol, at: t.time, sig: t.sig });
    }
  }
  const todo = [];
  for (const s of sends) if (!todo.some((x) => x.to === s.to)) todo.push(s);
  const creators = [];
  const open = [];
  let followed = 0;
  // les plus récents d'abord : ce sont eux qui peuvent encore lancer
  for (const s of todo.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, maxFollow)) {
    followed++;
    if (followed % 10 === 0) log(`Source ${source.slice(0, 4)}… : ${followed} / ${Math.min(todo.length, maxFollow)} envois suivis, ${creators.length} devs trouvés`);
    const f = await followToCreator(s.to, s.sol * SOL, rpc, sigs, maxHops);
    if (f.creates?.length) creators.push({ address: f.end, via: f.path.slice(0, -1), amount: s.sol, at: s.at, creates: f.creates, known: known.has(f.end) });
    else if (f.status === 'open') open.push({ address: f.end, via: f.path.slice(0, -1), amount: s.sol, at: s.at });
  }
  // financés dans les plages, rien lancé, encore leur SOL : ses prochains devs probables
  let waiting = [];
  if (open.length) {
    const bal = await rpc.balances(open.map((o) => o.address)).catch(() => ({}));
    waiting = open.map((o) => ({ ...o, balanceSol: (bal[o.address] || 0) / SOL })).filter((o) => o.balanceSol >= 0.5 * o.amount);
  }
  return { sends: todo.length, followed, creators, waiting, hitRate: followed ? creators.length / followed : 0, windowTxs: txs.length };
}

/**
 * Suit un envoi de wallet en wallet (relais, mouvements cachés compris) jusqu'au premier wallet qui crée un token.
 * Regarde les plus anciennes ET les plus récentes transactions de chaque wallet : un dev crée souvent juste après
 * avoir été financé, puis fait des centaines de trades.
 */
export async function followToCreator(address, lamports, rpc, sigs, maxHops = 6) {
  const path = [address];
  let cur = address; let amount = lamports;
  for (let hop = 0; hop <= maxHops; hop++) {
    const s = await sigs(cur, 1);
    const ok = s.list.filter((x) => !x.err);
    const pick = [...ok.slice(-30), ...ok.slice(0, 20)].filter((x, i, all) => all.findIndex((y) => y.signature === x.signature) === i);
    const txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
    const made = txs.filter((t) => t.create && t.signers.includes(cur)).sort((a, b) => (a.time || 0) - (b.time || 0));
    if (made.length) return { status: 'created', end: cur, path, creates: made.map((t) => ({ mint: t.create.mint, name: t.create.name, symbol: t.create.symbol, uri: t.create.uri, createdAt: t.time, creator: cur })) };
    if (ok.length > 4 && hop > 0) return { status: 'wallet', end: cur, path }; // plus un relais, pas un dev
    const outs = new Map();
    for (const t of txs) {
      // transaction pump.fun : seuls les virements directs comptent (pas l'achat, pas les mouvements du programme)
      for (const tr of t.pump ? t.transfers.filter((x) => x.top) : [...t.transfers, ...hiddenMoves(t, cur)]) if (tr.from === cur && tr.to !== cur) outs.set(tr.to, (outs.get(tr.to) || 0) + tr.lamports);
    }
    const next = [...outs.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!next || next[1] < 0.5 * amount || path.includes(next[0]) || labelOf(next[0])) return { status: 'open', end: cur, path };
    amount = next[1];
    cur = next[0];
    path.push(cur);
  }
  return { status: 'open', end: cur, path };
}

/**
 * Un wallet intermédiaire qui reçoit une somme (ex. 7 SOL) et la répartit entre plusieurs devs (ex. 2 SOL chacun) :
 * on regarde TOUS ses envois (pas seulement le plus gros) et on suit chaque destinataire jusqu'à un créateur de token.
 * @returns { devs: [{ address, via, amount, at, creates }], kids, busy }
 */
export async function followFanOut(address, rpc, sigs, { maxKids = 8, maxTx = 150, minSol = 0.05 } = {}) {
  const s = await sigs(address, 1);
  const ok = s.list.filter((x) => !x.err);
  if (!s.complete || ok.length > maxTx) return { devs: [], kids: 0, busy: true }; // trop actif : pas un intermédiaire jetable
  const txs = (await Promise.all(ok.slice(0, 80).map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
  const outs = new Map();
  for (const t of txs) {
    for (const tr of t.pump ? t.transfers.filter((x) => x.top) : t.transfers) {
      if (tr.from !== address || tr.to === address || labelOf(tr.to) || tr.lamports < minSol * SOL) continue;
      const o = outs.get(tr.to) || { to: tr.to, lamports: 0, at: t.time };
      o.lamports += tr.lamports;
      outs.set(tr.to, o);
    }
  }
  const kids = [...outs.values()].sort((a, b) => b.lamports - a.lamports).slice(0, maxKids);
  const devs = [];
  for (const k of kids) {
    const f = await followToCreator(k.to, k.lamports, rpc, sigs, 2);
    if (f.creates?.length) devs.push({ address: f.end, via: [address, ...f.path.slice(0, -1)], amount: k.lamports / SOL, at: k.at, creates: f.creates });
  }
  return { devs, kids: kids.length, busy: false };
}

/**
 * Le hub au-dessus d'une mère jetable : il reçoit de grosses sommes (ex. 1 000 SOL) et envoie de petits montants
 * (ex. 7, 9, 3 SOL) à des intermédiaires jetables, qui financent chacun des devs. C'est lui qui reste d'un cycle
 * à l'autre. On relit ses envois récents et on garde les destinataires qui mènent à des devs (en éventail).
 * @returns { address, sends, followed, mids: [{ address, amount, at, devs }] }
 */
export async function findHub(hub, rpc, sigs, { from, to, skip = new Set(), maxFollow = 25, minSol = 0.3, maxSol = 200, cap = 3000 } = {}, log = () => {}) {
  let txs = null;
  if (rpc.windowTxs) {
    try { const r = await rpc.windowTxs(hub, from, to, cap, 'desc'); txs = r?.txs || null; } catch { txs = null; }
  }
  if (!txs) {
    const s = await sigs(hub, 1);
    const pick = s.list.filter((x) => !x.err && x.time >= from && x.time <= to).slice(0, 300);
    txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature).catch(() => null)))).filter(Boolean);
  }
  const sends = new Map();
  for (const t of txs) {
    for (const tr of t.pump ? t.transfers.filter((x) => x.top) : t.transfers) {
      if (tr.from !== hub || tr.to === hub || skip.has(tr.to) || labelOf(tr.to)) continue;
      const sol = tr.lamports / SOL;
      if (sol < minSol || sol > maxSol) continue;
      if (!sends.has(tr.to)) sends.set(tr.to, { to: tr.to, sol, at: t.time });
    }
  }
  const todo = [...sends.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, maxFollow);
  const mids = [];
  let followed = 0;
  for (const s of todo) {
    followed++;
    if (followed % 5 === 0) log(`Hub ${hub.slice(0, 4)}… : ${followed} / ${todo.length} envois suivis, ${mids.length} intermédiaires qui financent des devs`);
    // l'envoi va directement à un dev ? (le hub finance aussi en direct)
    const direct = await followToCreator(s.to, s.sol * SOL, rpc, sigs, 1);
    if (direct.creates?.length) { mids.push({ address: s.to, amount: s.sol, at: s.at, direct: true, devs: [{ address: direct.end, via: [hub], amount: s.sol, at: s.at, creates: direct.creates }] }); continue; }
    const fan = await followFanOut(s.to, rpc, sigs);
    if (fan.devs.length) mids.push({ address: s.to, amount: s.sol, at: s.at, devs: fan.devs });
  }
  return { address: hub, sends: sends.size, followed, mids };
}
