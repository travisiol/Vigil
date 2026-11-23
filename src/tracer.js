import { labelOf, LABELS } from './labels.js';
import { fetchMarkets } from './market.js';
import { followForward, followMainFlow, FORWARD, activity, hiddenMoves } from './downstream.js';
import { sourcesOf, buildRanges, scanSource, findHub, TOL } from './census.js';
import { clusterRoute, forwardRoute, routeLogic, adviseBot, lastLaunchOf, INACTIVE_AFTER } from './advice.js';
import { detectSpider } from './spider.js';

const SOL = 1e9;

export const PRESETS = {
  rapide: { maxUp: 6, maxDown: 1, maxWallets: 15, maxTxPerWallet: 100, maxDestChecks: 15, maxPivots: 3, maxLinked: 5, maxDeposits: 4, hotWindowH: 3, hotTxCap: 300, maxLeads: 8, maxHotWallets: 1, fpWindowH: 24, fpExchangeH: 72, fpTxCap: 300, fpMaxVerify: 10 },
  normal: { maxUp: 8, maxDown: 2, maxWallets: 40, maxTxPerWallet: 200, maxDestChecks: 30, maxPivots: 6, maxLinked: 15, maxDeposits: 10, hotWindowH: 8, hotTxCap: 1500, maxLeads: 20, maxHotWallets: 2, fpWindowH: 24, fpExchangeH: 72, fpTxCap: 6000, fpMaxVerify: 30 },
  profond: { maxUp: 12, maxDown: 3, maxWallets: 120, maxTxPerWallet: 400, maxDestChecks: 60, maxPivots: 12, maxLinked: 40, maxDeposits: 30, hotWindowH: 24, hotTxCap: 6000, maxLeads: 50, maxHotWallets: 3, fpWindowH: 72, fpExchangeH: 72, fpTxCap: 20000, fpMaxVerify: 80 },
};
for (const k of Object.keys(PRESETS)) PRESETS[k].forward = FORWARD[k];
// maxPivots / maxLinked : rebond par les sorties (adresses de dépôt, wallets de collecte).
// maxDeposits / hotWindowH / hotTxCap / maxLeads / maxHotWallets : rapprochement dépôt -> retrait sur l'exchange.
// fpWindowH / fpTxCap / fpMaxVerify : empreinte de financement (envois du même montant depuis la source).
// fpExchangeH : durée lue quand la source est un vrai exchange (F Project : au moins 72 h, un rugger ne lance pas tous les jours).
const COMMON = {
  maxSigPages: 10, // au-delà de 10 000 transactions, on considère le wallet comme un service (exchange, bot)
  minSol: 0.02, // transferts plus petits ignorés (poussière, pourboires)
  maxHotPages: 40, // pages de signatures lues sur un hot wallet d'exchange pour remonter jusqu'au dépôt
  maxPivotTx: 120, // transactions lues sur une adresse de dépôt ou un wallet de collecte
  groupGapH: 6, // dépôts espacés de moins de 6 h : on cherche aussi le retrait de leur somme
  fpTolSol: 0.0001, // méthode F Project : un envoi de 1,15 SOL correspond de 1,1499 à 1,1501
  maxFollow: 5, // nombre de wallets relais suivis après un envoi de la source
};

/**
 * Trace le cluster d'un wallet pump.fun.
 * 1. Remonte le financement jusqu'à un exchange, un wallet à très forte activité ou l'origine.
 * 2. Redescend depuis le sommet : tous les wallets neufs financés par le cluster.
 * 3. Relève les tokens pump.fun créés et ce que le cluster en a fait (achats, ventes).
 * 4. Regroupe les sorties d'argent (dépôts exchange probables, wallets de collecte).
 * 5. Rebondit sur ces sorties : les autres wallets qui déposent au même endroit sont liés.
 * 6. Côté exchange : cherche, après chaque dépôt du dev, les retraits du même montant vers d'autres wallets.
 * 7. Empreinte : relit les envois récents de la source au montant exact reçu par le dev, et suit chacun jusqu'à un créateur.
 * 8. Déduit le schéma (wallet mère, chaîne dev vers dev, exchange) avec ses raisons.
 */
export async function trace(input, rpc, optsIn, emit = () => {}) {
  let start = input;
  const opts = { ...COMMON, ...PRESETS.normal, ...optsIn };
  const log = (msg) => emit({ type: 'log', msg });
  const minLamports = opts.minSol * SOL;

  // ---------- signatures (mémoire du job) ----------
  const sigMemo = new Map();
  async function sigs(address, maxPages) {
    let m = sigMemo.get(address);
    if (!m) { m = { list: [], complete: false, pages: 0 }; sigMemo.set(address, m); }
    while (!m.complete && m.pages < maxPages) {
      const before = m.list.length ? m.list[m.list.length - 1].signature : undefined;
      const page = await rpc.sigsPage(address, before, 1000);
      m.pages++;
      for (const s of page) m.list.push({ signature: s.signature, time: s.blockTime ?? null, err: !!s.err });
      if (page.length < 1000) m.complete = true;
    }
    return m;
  }

  // ---------- qui a financé ce wallet ? ----------
  async function findFunder(address) {
    const s = await sigs(address, opts.maxSigPages);
    if (!s.complete) return { busy: true };
    const oldest = s.list.filter((x) => !x.err).slice(-3).reverse();
    for (const o of oldest) {
      const t = await rpc.tx(o.signature);
      if (!t) continue;
      const tr = t.transfers.filter((x) => x.to === address && x.from !== address).sort((a, b) => b.lamports - a.lamports)[0];
      if (tr) return { funder: tr.from, lamports: tr.lamports, time: t.time, sig: t.sig };
      if (t.feePayer !== address && (t.solDelta[address] || 0) > 0) {
        return { funder: t.feePayer, lamports: t.solDelta[address], time: t.time, sig: t.sig };
      }
    }
    return { funder: null };
  }

  // ---------- 0. adresse de token ? on part de son dev ----------
  let fromToken = null;
  const acct = rpc.call ? await rpc.call('getAccountInfo', [start, { encoding: 'jsonParsed' }]).catch(() => null) : null;
  if (acct?.value?.data?.parsed?.type === 'mint') {
    const meta = acct.value.data.parsed.info?.extensions?.find((e) => e.extension === 'tokenMetadata')?.state;
    log(`${short(start)} est un token${meta?.symbol ? ` (${meta.symbol})` : ''} : recherche de son dev`);
    let creator = null;
    // avec Helius : l'historique du token lu depuis le début, la création est la toute première transaction
    if (rpc.windowTxs) {
      const first = await rpc.windowTxs(start, 0, Math.floor(Date.now() / 1000) + 60, 5, 'asc').catch(() => null);
      const c = first?.txs.find((x) => x.create?.mint === start);
      if (c) creator = c.feePayer;
    }
    if (!creator) {
      const s = await sigs(start, rpc.perMethod ? 12 : 40);
      if (!s.complete) throw new Error(`Token trop actif pour remonter jusqu'à sa création (plus de ${s.list.length} transactions). Colle plutôt l'adresse du dev.`);
      for (const o of s.list.slice(-5).reverse()) {
        const x = await rpc.tx(o.signature).catch(() => null);
        if (x?.create?.mint === start) { creator = x.feePayer; break; }
      }
    }
    if (!creator) throw new Error("Ce token n'a pas été créé sur pump.fun : dev introuvable.");
    fromToken = { mint: start, name: meta?.name || null, symbol: meta?.symbol || null };
    log(`Dev du token : ${short(creator)}`);
    start = creator;
  }

  // ---------- 1. remontée ----------
  log(`Remontée du financement depuis ${short(start)}`);
  const chain = []; // du wallet de départ vers le sommet
  let terminal = { type: 'unknown' };
  const seen = new Set();
  let hops = 0; // niveaux comptés : les relais (4 transactions au plus) ne comptent pas
  let stopNext = false; // le financeur est un mélangeur : on l'inclut, puis on s'arrête (au-dessus, ce n'est plus son argent)
  let cur = start;
  for (let depth = 0; ; depth++) {
    const label = labelOf(cur);
    if (label && label.type !== 'infra') {
      terminal = { type: label.type === 'exchange' ? 'exchange' : 'service', address: cur, label: label.name };
      break;
    }
    if (seen.has(cur)) { terminal = { type: 'cycle', address: cur }; break; }
    seen.add(cur);
    const f = await findFunder(cur);
    if (f.busy) {
      if (cur === start) {
        // Lanceur en série : trop d'historique pour retrouver son premier financement, on analyse son activité récente.
        chain.push({ address: cur, funder: null, lamports: 0, time: null, sig: null });
        terminal = { type: 'truncated', address: cur };
        break;
      }
      terminal = { type: 'busy', address: cur };
      // Un wallet sans nom qui détient des milliers de SOL et envoie sans arrêt : c'est un exchange.
      if (rpc.balances) {
        const b = await rpc.balances([cur]).catch(() => ({}));
        terminal.balanceSol = (b[cur] || 0) / SOL;
        if (terminal.balanceSol >= HOT_SOL) {
          terminal.hot = true;
          terminal.label = 'Exchange sans nom';
          log(`${short(cur)} détient ${Math.round(terminal.balanceSol).toLocaleString('fr-FR')} SOL : exchange probable, sans nom connu`);
        }
      }
      break;
    }
    chain.push({ address: cur, funder: f.funder, lamports: f.lamports ?? 0, time: f.time ?? null, sig: f.sig ?? null });
    if (stopNext) { terminal = { type: 'mixer', address: cur }; break; }
    if (!f.funder) { terminal = { type: 'origin', address: cur }; break; }
    log(`${short(cur)} financé par ${short(f.funder)} (${fmtSol(f.lamports)} SOL)`);
    if ((sigMemo.get(cur)?.list.length ?? 99) > 4 || cur === start) hops++;
    if ((hops >= opts.maxUp || depth >= opts.maxUp * 3) && !labelOf(f.funder)) { terminal = { type: 'depth', address: f.funder }; break; }
    if (f.funder && !labelOf(f.funder)) {
      const sf = await sigs(f.funder, 1);
      if (sf.complete && sf.list.length >= 50 && activity(sf.list).bursts === 1) stopNext = true; // une seule rafale de dizaines de transactions : mélangeur
    }
    cur = f.funder;
  }
  const TERMINAL_MSG = {
    exchange: () => `Origine : exchange ${terminal.label}`,
    service: () => `Origine : service ${terminal.label}`,
    busy: () => `Origine : wallet à très forte activité ${short(terminal.address)} (exchange ou bot probable)`,
    origin: () => `Origine introuvable au-dessus de ${short(terminal.address)}`,
    truncated: () => `Plus de ${opts.maxSigPages * 1000} transactions sur ${short(terminal.address)} : financement d'origine hors de portée, analyse de l'activité récente`,
    depth: () => `Remontée arrêtée à la profondeur maximale (${opts.maxUp})`,
    cycle: () => `Boucle de financement détectée sur ${short(terminal.address)}`,
    mixer: () => `Remontée arrêtée au mélangeur ${short(terminal.address)} : au-dessus, l'argent n'est plus le sien`,
  };
  log(TERMINAL_MSG[terminal.type]?.() || 'Remontée terminée');

  // ---------- 2. cluster ----------
  const cluster = new Map();
  const edges = [];
  const rootAddr = chain[chain.length - 1].address;
  // la chaîne fait toujours partie du cluster
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i];
    cluster.set(c.address, newWallet(c.address, { hop: 0, inChain: true, funder: c.funder, fundedLamports: c.lamports, fundedAt: c.time, fundSig: c.sig }));
    if (c.funder) edges.push({ from: c.funder, to: c.address, lamports: c.lamports, time: c.time, sig: c.sig });
  }
  cluster.get(start).isStart = true;

  const queue = [...cluster.keys()]; // sommet d'abord
  const deposits = new Map(); // adresse de dépôt d'exchange -> { exchange, sweepTo }
  let skippedChildren = 0;
  let scanned = 0;
  await drain();

  async function drain() {
   while (queue.length) {
    const addr = queue.shift();
    const w = cluster.get(addr);
    if (!w) continue;
    await scanWallet(w);
    // Un wallet neuf qui ne crée rien et renvoie tout vers un exchange est une adresse de dépôt, pas un wallet du dev.
    const toExchange = w.out.find((o) => o.kind === 'exchange');
    if (!w.inChain && !w.creates.length && toExchange) {
      deposits.set(w.address, { exchange: toExchange.label, sweepTo: toExchange.to });
      cluster.delete(w.address);
      for (let i = edges.length - 1; i >= 0; i--) if (edges[i].to === w.address) edges.splice(i, 1);
      for (const other of cluster.values()) for (const o of other.out) if (o.to === w.address) { o.kind = 'external'; o.depositOf = toExchange.label; }
      log(`${short(w.address)} est une adresse de dépôt ${toExchange.label}`);
      continue;
    }
    scanned++;
    emit({ type: 'progress', scanned, total: cluster.size, calls: rpc.calls });
   }
  }

  async function scanWallet(w) {
    const s = await sigs(w.address, opts.maxSigPages);
    const ok = s.list.filter((x) => !x.err);
    // l'adresse tracée se lit plus loin avec Helius (lecture par paquets de 100) : tous ses tokens, même s'il relance souvent
    const limit = w.isStart && !rpc.perMethod ? Math.max(opts.maxTxPerWallet, 1000) : opts.maxTxPerWallet;
    const pick = ok.slice(0, limit); // les plus récentes
    w.txCount = s.list.length;
    w.truncated = ok.length > pick.length || !s.complete;
    log(`Analyse de ${short(w.address)} : ${pick.length} transaction${pick.length > 1 ? 's' : ''}${w.truncated ? ' (historique tronqué)' : ''}`);
    await rpc.prefetch?.(w.address, pick);
    const txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature)))).filter(Boolean);
    txs.sort((a, b) => (a.time || 0) - (b.time || 0));
    if (txs.length) { w.firstTx = txs[0].time; w.lastTx = txs[txs.length - 1].time; }
    // une adresse qui n'a jamais signé n'agit pas : ce n'est pas un dev (wallet qui reçoit juste des miettes, compte fermé…)
    w.signed = txs.filter((t) => t.signers.includes(w.address)).length;
    w.failedCount = s.list.length - ok.length;
    if (!w.signed && txs.length) {
      const by = new Map();
      for (const t of txs) by.set(t.feePayer, (by.get(t.feePayer) || 0) + 1);
      w.mainSigner = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }

    const dests = new Map();
    for (const t of txs) {
      const signer = t.signers.includes(w.address);
      if (t.create && signer) w.creates.push({ ...t.create, time: t.time, sig: t.sig });
      const fee = t.feePayer === w.address ? t.fee : 0;
      const sol = (t.solDelta[w.address] || 0) + fee;
      // frais de créateur : pump.fun reverse au dev une part des frais de trading, qu'il réclame sans toucher au token
      if (t.pump && signer && !t.create && sol > 1e6 && !t.tokenDelta.some((d) => d.owner === w.address)) w.feeClaims.push({ lamports: sol, time: t.time });
      for (const td of t.tokenDelta) {
        if (td.owner === w.address) w.tokenMoves.push({ mint: td.mint, delta: td.delta, post: td.post, sol, time: t.time, sig: t.sig });
      }
      for (const tr of t.transfers) {
        if (tr.top && tr.from === w.address && tr.to !== w.address && tr.lamports >= minLamports && signer) {
          const d = dests.get(tr.to) || { to: tr.to, lamports: 0, count: 0, last: 0, first: Infinity, sigs: new Set(), firstLamports: 0, events: [] };
          if ((t.time || 0) < d.first) { d.first = t.time || 0; d.firstLamports = tr.lamports; d.firstSig = t.sig; }
          d.lamports += tr.lamports; d.count++; d.last = Math.max(d.last, t.time || 0); d.sigs.add(t.sig);
          d.events.push({ lamports: tr.lamports, time: t.time || 0, sig: t.sig });
          dests.set(tr.to, d);
        }
        if (tr.to === w.address && tr.from !== w.address) w.receivedLamports += tr.lamports;
      }
    }

    // Classe chaque destinataire : wallet enfant (neuf, financé par nous), interne, exchange, service, externe.
    const list = [...dests.values()].sort((a, b) => b.last - a.last);
    let checks = 0;
    for (const d of list) {
      let kind;
      const label = labelOf(d.to);
      if (cluster.has(d.to)) kind = 'internal';
      else if (deposits.has(d.to)) kind = 'external';
      else if (label) kind = label.type;
      else if (checks >= opts.maxDestChecks) kind = 'external';
      else {
        checks++;
        const ds = await sigs(d.to, 1);
        if (!ds.complete) kind = 'busy';
        else {
          const oldest3 = ds.list.slice(-3).map((x) => x.signature);
          kind = oldest3.some((sg) => d.sigs.has(sg)) ? 'fresh' : 'external';
        }
      }
      if (kind === 'fresh') {
        if (w.hop + 1 <= opts.maxDown && cluster.size < opts.maxWallets) {
          cluster.set(d.to, newWallet(d.to, { hop: w.hop + 1, funder: w.address, fundedLamports: d.firstLamports, fundedAt: d.first, fundSig: d.firstSig }));
          edges.push({ from: w.address, to: d.to, lamports: d.firstLamports, time: d.first, sig: d.firstSig });
          queue.push(d.to);
          kind = 'internal';
        } else {
          skippedChildren++;
          kind = 'child-unexplored';
        }
      }
      w.out.push({ to: d.to, lamports: d.lamports, count: d.count, last: d.last, kind, label: label?.name || null, depositOf: deposits.get(d.to)?.exchange || null, events: d.events });
    }
  }

  // ---------- 4. sorties d'argent ----------
  function buildCash() {
    const cash = new Map();
    for (const w of cluster.values()) {
      for (const o of w.out) {
        if (o.kind === 'internal' || o.kind === 'infra' || o.kind === 'child-unexplored' || cluster.has(o.to)) continue;
        const c = cash.get(o.to) || { address: o.to, kind: o.kind, label: o.label, lamports: 0, count: 0, last: 0, from: new Set(), depositOf: null };
        c.lamports += o.lamports; c.count += o.count; c.last = Math.max(c.last, o.last); c.from.add(w.address);
        c.depositOf = deposits.get(o.to)?.exchange || c.depositOf;
        cash.set(o.to, c);
      }
    }
    return [...cash.values()].sort((a, b) => b.lamports - a.lamports);
  }
  // Une adresse de dépôt d'exchange renvoie tout vers le hot wallet de l'exchange : on le vérifie sur les plus grosses sorties.
  const probed = new Set();
  async function probeDeposits(list) {
    const probe = list.filter((c) => c.kind === 'external' && !c.depositOf && !probed.has(c.address)).slice(0, 8);
    if (probe.length) log(`Recherche d'adresses de dépôt d'exchange parmi ${probe.length} sortie${probe.length > 1 ? 's' : ''}`);
    for (const c of probe) {
      probed.add(c.address);
      const ds = await sigs(c.address, 1);
      const recent = ds.list.filter((x) => !x.err).slice(0, 6);
      for (const r of recent) {
        const t = await rpc.tx(r.signature);
        const hit = t?.transfers.find((x) => x.from === c.address && labelOf(x.to)?.type === 'exchange');
        if (hit) {
          c.depositOf = labelOf(hit.to).name;
          deposits.set(c.address, { exchange: c.depositOf, sweepTo: hit.to });
          break;
        }
      }
    }
  }
  let cashList = buildCash();
  await probeDeposits(cashList);

  // ---------- 5. rebond par les sorties ----------
  // Qui d'autre envoie du SOL à cette adresse ?
  async function incomingSenders(address) {
    const s = await sigs(address, 1);
    const pick = s.list.filter((x) => !x.err).slice(0, opts.maxPivotTx);
    const txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature)))).filter(Boolean);
    const m = new Map();
    for (const t of txs) {
      for (const tr of t.transfers) {
        if (!tr.top || tr.to !== address || tr.from === address || tr.lamports < minLamports) continue;
        const e = m.get(tr.from) || { from: tr.from, lamports: 0, last: 0 };
        e.lamports += tr.lamports; e.last = Math.max(e.last, t.time || 0);
        m.set(tr.from, e);
      }
    }
    return [...m.values()].sort((a, b) => b.last - a.last);
  }

  const pivots = [
    ...cashList.filter((c) => c.kind === 'external' && c.depositOf).map((c) => ({ c, type: 'deposit' })),
    // wallet de collecte : reçoit de plusieurs wallets du cluster, ou au moins 1 SOL
    ...cashList.filter((c) => c.kind === 'external' && !c.depositOf && (c.from.size >= 2 || c.lamports >= SOL)).map((c) => ({ c, type: 'collector' })),
  ].slice(0, opts.maxPivots);
  let linkedCount = 0;
  let skippedLinked = 0;
  const newcomers = [];
  for (const { c, type } of pivots) {
    log(type === 'deposit'
      ? `Rebond sur l'adresse de dépôt ${c.depositOf} ${short(c.address)}`
      : `Rebond sur le wallet de collecte ${short(c.address)}`);
    if (type === 'collector' && !cluster.has(c.address)) {
      cluster.set(c.address, newWallet(c.address, { hop: 0, link: { type: 'collects', from: [...c.from] } }));
      queue.push(c.address);
      newcomers.push(c.address);
    }
    const senders = await incomingSenders(c.address);
    const toCheck = senders.filter((x) => !cluster.has(x.from) && !labelOf(x.from) && !deposits.has(x.from)).length;
    if (toCheck) log(`${toCheck} autre${toCheck > 1 ? 's wallets envoient' : ' wallet envoie'} vers ${short(c.address)} : vérification`);
    for (const s of senders) {
      if (cluster.has(s.from) || labelOf(s.from) || deposits.has(s.from)) continue;
      if (linkedCount >= opts.maxLinked) { skippedLinked++; continue; }
      const ds = await sigs(s.from, 1);
      if (!ds.complete) continue; // plus de 1 000 transactions : service ou bot, pas un wallet de dev
      cluster.set(s.from, newWallet(s.from, { hop: opts.maxDown, link: { type, via: c.address, exchange: c.depositOf || null } }));
      queue.push(s.from);
      newcomers.push(s.from);
      linkedCount++;
    }
  }
  if (newcomers.length) {
    log(`${newcomers.length} wallet${newcomers.length > 1 ? 's' : ''} lié${newcomers.length > 1 ? 's' : ''} par les sorties`);
    for (const a of newcomers) {
      const f = await findFunder(a);
      const w = cluster.get(a);
      if (!w || !f.funder) continue;
      w.funder = f.funder; w.fundedLamports = f.lamports; w.fundedAt = f.time; w.fundSig = f.sig;
      edges.push({ from: f.funder, to: a, lamports: f.lamports, time: f.time, sig: f.sig });
    }
    await drain();
    cashList = buildCash();
    await probeDeposits(cashList);
  }

  // ---------- 6. rapprochement dépôt -> retrait sur l'exchange ----------
  // Le dev dépose X SOL sur l'exchange, puis retire vers un wallet neuf. Le retrait part du hot wallet
  // de l'exchange : on lit ses sorties dans les heures qui suivent et on garde celles du même montant.
  const leads = [];
  const exchangeScan = [];
  {
    const byExchange = new Map(); // exchange -> { events, habits, hots }
    const slot = (ex) => { if (!byExchange.has(ex)) byExchange.set(ex, { events: [], hots: [] }); return byExchange.get(ex); };
    for (const w of cluster.values()) {
      for (const o of w.out) {
        const dep = deposits.get(o.to);
        const ex = dep?.exchange || (o.kind === 'exchange' ? o.label : null);
        if (!ex) continue;
        const g = slot(ex);
        for (const e of o.events || []) g.events.push({ ...e, from: w.address, to: o.to });
        if (dep?.sweepTo) g.hots.push(dep.sweepTo); else if (o.kind === 'exchange') g.hots.push(o.to);
      }
      // le hot wallet qui a déjà financé le cluster est le premier à lire
      const fl = w.funder && labelOf(w.funder);
      if (fl?.type === 'exchange') slot(fl.name).hots.unshift(w.funder);
    }
    const windowSec = opts.hotWindowH * 3600;
    for (const [exchange, g] of byExchange) {
      if (!g.events.length) continue;
      // cibles : chaque dépôt, et la somme des dépôts rapprochés
      g.events.sort((a, b) => a.time - b.time);
      const targets = g.events.map((e) => ({ lamports: e.lamports, time: e.time, from: [e.from], to: e.to, parts: 1 }));
      let group = [];
      const flush = () => {
        if (group.length >= 2) targets.push({ lamports: group.reduce((s, e) => s + e.lamports, 0), time: group[group.length - 1].time, from: [...new Set(group.map((e) => e.from))], to: group[0].to, parts: group.length });
        group = [];
      };
      for (const e of g.events) {
        if (group.length && (e.time - group[group.length - 1].time > opts.groupGapH * 3600 || e.to !== group[0].to)) flush();
        group.push(e);
      }
      flush();
      targets.sort((a, b) => b.time - a.time);
      const kept = targets.slice(0, opts.maxDeposits);
      const hots = [...new Set(g.hots)].slice(0, opts.maxHotWallets);

      for (const hot of hots) {
        // fenêtres de lecture fusionnées, la plus récente d'abord
        const wins = [];
        for (const t of [...kept].sort((a, b) => a.time - b.time)) {
          const last = wins[wins.length - 1];
          if (last && t.time <= last.to) last.to = Math.max(last.to, t.time + windowSec);
          else wins.push({ from: t.time, to: t.time + windowSec });
        }
        wins.reverse();
        log(`Lecture des retraits ${exchange} (${short(hot)}) après ${kept.length} dépôt${kept.length > 1 ? 's' : ''}, fenêtre de ${opts.hotWindowH} h`);
        let budget = opts.hotTxCap;
        let read = 0;
        const status = new Set();
        const found = new Map(); // destinataire -> meilleure correspondance
        for (const win of wins) {
          if (budget <= 0) { status.add('capped'); break; }
          const r = await windowTxs(hot, win.from, win.to, budget);
          status.add(r.status);
          budget -= r.txs.length;
          read += r.txs.length;
          for (const t of r.txs) {
            for (const tr of t.transfers) {
              if (tr.from !== hot || tr.lamports < minLamports) continue;
              if (cluster.has(tr.to) || labelOf(tr.to) || deposits.has(tr.to)) continue;
              let best = null;
              for (const tg of kept) {
                if (t.time < tg.time || t.time > tg.time + windowSec) continue;
                const diff = tg.lamports - tr.lamports; // l'exchange garde des frais de retrait
                if (diff < -0.001 * SOL || diff > Math.max(0.03 * SOL, 0.01 * tg.lamports)) continue;
                if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { type: 'same', diff, target: tg };
              }
              if (!best) continue;
              const prev = found.get(tr.to);
              if (prev && (prev.type === 'same' || best.type !== 'same')) continue;
              found.set(tr.to, { ...best, address: tr.to, lamports: tr.lamports, time: t.time, sig: t.sig });
            }
          }
        }
        // un montant rond revient souvent par hasard : on compte les retraits qui tombent sur la même cible
        const perTarget = new Map();
        for (const f of found.values()) perTarget.set(f.target, (perTarget.get(f.target) || 0) + 1);
        const ranked = [...found.values()].sort((a, b) => (a.type === b.type ? (a.time - a.target.time) - (b.time - b.target.time) : a.type === 'same' ? -1 : 1));
        for (const f of ranked.slice(0, opts.maxLeads)) {
          const peek = await peekWallet(f.address, f.sig);
          if (peek.busy) continue;
          const delay = f.time - f.target.time;
          const twins = perTarget.get(f.target);
          let score = f.type === 'same' ? 50 : 30;
          if (peek.fresh) score += 25;
          score += delay <= 3600 ? 15 : delay <= 6 * 3600 ? 8 : 0;
          if (peek.tokens) score += 10;
          score -= Math.min(30, 6 * (twins - 1));
          leads.push({
            address: f.address, exchange, hot, type: f.type, sol: f.lamports / SOL, time: f.time, sig: f.sig, delaySeconds: delay,
            depositSol: f.target.lamports / SOL, depositAt: f.target.time, depositFrom: f.target.from, depositParts: f.target.parts,
            fresh: peek.fresh, tokens: peek.tokens, txCount: peek.txCount, lastTx: peek.lastTx, twins, score: Math.max(0, Math.min(100, score)),
          });
        }
        const order = ['out-of-reach', 'capped', 'partial', 'ok'];
        exchangeScan.push({ exchange, hot, deposits: kept.length, windowHours: opts.hotWindowH, read, matches: found.size, status: order.find((x) => status.has(x)) || 'ok' });
      }
    }
    if (exchangeScan.length) log(`${leads.length} piste${leads.length > 1 ? 's' : ''} côté exchange`);
  }

  // ---------- 7. empreinte de financement ----------
  // Le dev reçoit toujours le même montant de la même source (exchange, ou wallet à très forte activité).
  // On relit les envois récents de cette source, on garde ceux du même montant à 0,0001 SOL près,
  // puis on suit chaque destinataire de wallet en wallet pour voir s'il mène à un créateur de token.
  // Le taux de créateurs dit si le filtre vaut quelque chose : un montant courant donne un taux faible.
  const fingerprints = [];
  {
    const now = opts.now || Math.floor(Date.now() / 1000);
    const tol = opts.fpTolSol * SOL;
    const sources = new Map();
    const addFp = (origin, name, kind, lamports, to, at = null) => {
      // un retrait d'exchange, même minuscule (0,014 SOL pour juste créer un token), est une signature
      if (!origin || !(lamports >= (kind === 'busy' ? minLamports : 0.005 * SOL))) return;
      if (!sources.has(origin)) sources.set(origin, { origin, name, kind, fps: [], times: [] });
      const src = sources.get(origin);
      let fp = src.fps.find((f) => Math.abs(f.lamports - lamports) <= tol);
      if (!fp) { fp = { lamports, examples: [] }; src.fps.push(fp); }
      if (!fp.examples.includes(to)) fp.examples.push(to);
      if (at && !src.times.includes(at)) src.times.push(at);
    };
    const top = chain[chain.length - 1];
    if (top.funder && ['exchange', 'service', 'busy'].includes(terminal.type)) {
      addFp(top.funder, terminal.label || 'Wallet à forte activité', terminal.type === 'busy' ? (terminal.hot ? 'hot' : 'busy') : 'exchange', top.lamports, top.address, top.time);
    }
    for (const w of cluster.values()) {
      const fl = w.funder && labelOf(w.funder);
      if (fl?.type === 'exchange') addFp(w.funder, fl.name, 'exchange', w.fundedLamports, w.address, w.fundedAt);
    }
    // tous les retraits d'exchange du dev avant son premier lancement, pas seulement le plus gros :
    // le montant qu'il répète d'un dev à l'autre peut être le petit (ex. 1,42 SOL à côté d'un retrait de 8,46)
    {
      const me = cluster.get(start);
      const firstAt = Math.min(Infinity, ...(me?.creates || []).map((c) => c.time).filter(Boolean));
      const s = await sigs(start, 1);
      const early = s.list.filter((x) => !x.err && (x.time == null || x.time <= firstAt)).slice(-40);
      const txs = (await Promise.all(early.map((x) => Promise.resolve().then(() => rpc.tx(x.signature)).catch(() => null)))).filter(Boolean);
      let added = 0;
      for (const t of txs) {
        for (const tr of t.transfers) {
          const l = tr.to === start && tr.from !== start ? labelOf(tr.from) : null;
          if (l?.type !== 'exchange') continue;
          const before = sources.get(tr.from)?.fps.length || 0;
          addFp(tr.from, l.name, 'exchange', tr.lamports, start, t.time);
          if ((sources.get(tr.from)?.fps.length || 0) > before) added++;
        }
      }
      const all = [...sources.values()].filter((x) => x.kind === 'exchange').reduce((n, x) => n + x.fps.length, 0);
      if (all > 1) log(`Le dev a reçu ${all} retraits d'exchange avant son lancement : chaque montant est cherché`);
    }
    for (const src of [...sources.values()].slice(0, opts.maxHotWallets + 1)) {
      src.fps = src.fps.slice(0, 3);
      // lecture profonde seulement pour un vrai exchange (nommé, ou sans nom mais très riche) ; un wallet actif sans nom est vu par le recensement
      // une adresse qui relance elle-même ne sera jamais un tracker : lecture normale, sans fouille profonde
      const serial = (cluster.get(start)?.creates.length || 0) >= 2;
      const deep = !serial && (src.kind === 'exchange' || src.kind === 'hot');
      const sliced = deep && !!rpc.windowTxs && !rpc.perMethod;
      const hours = sliced ? Math.max(opts.fpWindowH, opts.fpExchangeH || 72) : opts.fpWindowH;
      log(`Empreinte : ${src.name} envoie ${src.fps.map((f) => (f.lamports / SOL).toFixed(4)).join(', ')} SOL. Lecture de ses envois sur ${hours} h`);
      const since = now - hours * 3600;
      // RPC public : ~1 transaction par seconde, on se limite aux envois les plus récents pour rester sous ~10 min
      // avec Helius on lit beaucoup plus loin : les hot wallets des gros exchanges font des dizaines de milliers d'envois par jour
      const cap = rpc.perMethod ? Math.min(opts.fpTxCap, 600) : deep ? Math.max(opts.fpTxCap, opts.fpHeliusCap || 20000) : Math.min(opts.fpTxCap, 3000);
      if (rpc.perMethod) log(`RPC public : lecture des ${cap} derniers envois au plus (environ ${Math.ceil((cap * (rpc.interval || 1000)) / 60000)} min). Une clé Helius lit les ${opts.fpTxCap} en moins d'une minute`);
      // garde seulement les transactions qui envoient un des montants cherchés depuis cette adresse
      const keepFrom = (addr) => (t) => t.transfers.some((tr) => tr.from === addr && src.fps.some((f) => Math.abs(f.lamports - tr.lamports) <= tol));
      const r = (sliced && (await slicedTxs(src.origin, since, now, Math.round(cap * Math.max(1, hours / 24)), keepFrom(src.origin), src.name))) || (await recentTxs(src.origin, since, now, cap));
      // et autour du moment où ses devs ont été retirés : c'est là que ses autres retraits ont le plus de chances d'être
      if (!rpc.perMethod && rpc.windowTxs && deep) {
        const seen = new Set(r.txs.map((t) => t.sig));
        const around = [...new Set(src.times.map((t) => Math.round(t / 21600)))].map((k) => k * 21600).filter((t) => t < (r.coveredFrom ?? since));
        for (const t of around.slice(0, 3)) {
          const extra = await rpc.windowTxs(src.origin, t - 6 * 3600, t + 6 * 3600, 8000, 'asc').catch(() => null);
          for (const x of extra?.txs || []) if (!seen.has(x.sig)) { seen.add(x.sig); r.txs.push(x); }
        }
        if (around.length) log(`Envois de ${src.name} relus aussi autour du retrait de son dev (±6 h)`);
      }
      // le même exchange retire aussi depuis ses autres hot wallets connus : ses autres devs peuvent en sortir.
      // On les lit sur 24 h autour du retrait du dev (un exchange en a plusieurs, tous les lire sur 72 h coûterait trop cher)
      const others = sliced && src.kind === 'exchange'
        ? Object.entries(LABELS).filter(([a, l]) => l.type === 'exchange' && l.name === src.name && a !== src.origin && !sources.has(a)).map(([a]) => a).slice(0, 4)
        : [];
      const otherRead = new Map();
      const around2 = [...new Set((src.times.length ? src.times : [now]).map((t) => Math.round(t / 3600) * 3600))].slice(0, 2);
      for (const o of others) {
        let read = 0;
        for (const t of around2) {
          const ro = await slicedTxs(o, t - 12 * 3600, Math.min(now, t + 12 * 3600), 24000, keepFrom(o), `${src.name} ${short(o)}`);
          if (!ro) continue;
          read += ro.read;
          r.txs.push(...ro.txs);
        }
        otherRead.set(o, read);
      }
      if (others.length) log(`Mêmes montants cherchés chez ${others.length} autre${others.length > 1 ? 's' : ''} hot wallet${others.length > 1 ? 's' : ''} ${src.name}`);
      const hits = [];
      const seenHit = new Set();
      const from = new Set([src.origin, ...others]);
      for (const t of r.txs) {
        for (const tr of t.transfers) {
          if (!from.has(tr.from) || seenHit.has(`${t.sig}:${tr.to}`)) continue;
          const fp = src.fps.find((f) => Math.abs(f.lamports - tr.lamports) <= tol);
          if (fp) { seenHit.add(`${t.sig}:${tr.to}`); hits.push({ fp, to: tr.to, from: tr.from, lamports: tr.lamports, time: t.time, sig: t.sig }); }
        }
      }
      hits.sort((a, b) => b.time - a.time);
      for (const fp of src.fps) {
        const mine = hits.filter((h) => h.fp === fp);
        const known = new Set(mine.filter((h) => cluster.has(h.to)).map((h) => h.to)).size;
        const todo = [];
        for (const h of mine) {
          if (cluster.has(h.to) || labelOf(h.to) || deposits.has(h.to) || todo.some((x) => x.to === h.to)) continue;
          todo.push(h);
        }
        const checked = [];
        for (const h of todo.slice(0, opts.fpMaxVerify)) {
          checked.push({ h, f: await followFunds(h.to, h.lamports) });
          if (checked.length % 5 === 0) log(`Envois de ${(fp.lamports / SOL).toFixed(4)} SOL suivis : ${checked.length} / ${Math.min(todo.length, opts.fpMaxVerify)}`);
        }
        // un wallet sans token : candidat s'il a encore du SOL, sinon piste morte
        const open = checked.filter((c) => c.f.status === 'open');
        const bal = open.length ? await rpc.balances(open.map((c) => c.f.end)) : {};
        for (const c of checked) {
          c.f.balance = bal[c.f.end] ?? null;
          if (c.f.status === 'open') c.f.status = (c.f.balance ?? 0) >= 0.05 * SOL ? 'waiting' : 'empty';
        }
        const creators = checked.filter((c) => c.f.status === 'created' || c.f.status === 'cluster').length;
        const waiting = checked.filter((c) => c.f.status === 'waiting').length;
        const rate = checked.length ? creators / checked.length : 0;
        const verdict = checked.length < 3 ? 'insufficient' : rate >= 0.6 ? 'reliable' : rate >= 0.3 ? 'medium' : 'weak';
        fingerprints.push({
          source: src.origin, name: src.name, kind: src.kind, trackable: src.kind === 'exchange', sol: fp.lamports / SOL, tolSol: opts.fpTolSol, examples: fp.examples,
          windowHours: hours, coveredHours: Math.max(0, Math.min(hours, (now - r.coveredFrom) / 3600)), txRead: r.read ?? r.txs.length, status: r.status,
          sends: todo.length, known, verified: checked.length, creators, waiting, rate, verdict,
          // créateurs trouvés par adresse d'envoi (le hot wallet du dev, puis les autres du même exchange)
          bySource: [src.origin, ...others].map((a) => ({
            address: a, main: a === src.origin, read: a === src.origin ? (r.read ?? r.txs.length) : otherRead.get(a) || 0,
            sends: todo.filter((h) => h.from === a).length,
            creators: checked.filter((c) => c.h.from === a && (c.f.status === 'created' || c.f.status === 'cluster')).length,
          })),
        });
        for (const { h, f } of checked) {
          const score = Math.round(f.status === 'waiting' ? 40 + 60 * rate : f.status === 'created' || f.status === 'cluster' ? 30 + 60 * rate : 15 * rate);
          leads.push({
            type: 'fingerprint', address: h.to, end: f.end, path: f.path, hops: f.path.length - 1, status: f.status, movedTo: f.movedTo || null,
            exchange: src.name, hot: h.from || src.origin, sol: h.lamports / SOL, fpSol: fp.lamports / SOL, time: h.time, sig: h.sig,
            tokens: f.tokens || 0, creates: f.creates || [], firstCreateAt: f.firstCreateAt || null, createDelay: f.firstCreateAt ? f.firstCreateAt - h.time : null,
            balanceSol: f.balance != null ? f.balance / SOL : null, score: Math.max(0, Math.min(100, score)),
          });
        }
        log(`${(fp.lamports / SOL).toFixed(4)} SOL depuis ${src.name} : ${todo.length} envoi${todo.length > 1 ? 's' : ''}, ${checked.length} suivi${checked.length > 1 ? 's' : ''}, ${creators} vers un créateur de token`);
      }
    }
    leads.sort((a, b) => b.score - a.score);
  }

  // Envois d'un exchange sur une longue période (Helius) : tranches de 6 h lues 4 par 4 en parallèle.
  // Des dizaines de milliers de retraits : rien n'est gardé dans le cache, seules les transactions utiles (keepTx) restent.
  // Renvoie null si la lecture par dates n'est pas disponible (l'appelant passe alors à la méthode standard).
  async function slicedTxs(origin, since, until, cap, keepTx, name) {
    const step = 6 * 3600;
    const slices = [];
    for (let to = until; to > since; to -= step) slices.push([Math.max(since, to - step), to]);
    const per = Math.max(500, Math.ceil(cap / slices.length));
    const kept = new Map();
    let read = 0, capped = 0, covered = 0, ok = 0, done = 0;
    const run = async ([from, to]) => {
      const r = await rpc.windowTxs(origin, from, to, per, 'desc', null, false).catch(() => null);
      done++;
      if (!r) return;
      ok++;
      read += r.txs.length;
      for (const t of r.txs) if (keepTx(t)) kept.set(t.sig, t);
      const last = r.txs[r.txs.length - 1]?.time;
      covered += r.capped ? (last ? to - Math.max(from, last) : 0) : to - from;
      if (r.capped) capped++;
    };
    for (let i = 0; i < slices.length; i += 4) {
      await Promise.all(slices.slice(i, i + 4).map(run));
      if (slices.length > 4) log(`Envois de ${name} : ${Math.round((Math.min(i + 4, slices.length) * step) / 3600)} h / ${Math.round((until - since) / 3600)} h lues (${read.toLocaleString('fr-FR')} transactions)`);
    }
    if (!ok) return null;
    return { txs: [...kept.values()], read, status: capped ? 'capped' : 'ok', coveredFrom: until - covered };
  }

  // Envois récents d'une source, du plus récent au plus ancien, dans la limite de `cap` transactions.
  async function recentTxs(origin, since, until, cap) {
    if (rpc.windowTxs) {
      try {
        const r = await rpc.windowTxs(origin, since, until, cap, 'desc');
        if (r) return { txs: r.txs, status: r.capped ? 'capped' : 'ok', coveredFrom: r.capped && r.txs.length ? r.txs[r.txs.length - 1].time : since };
      } catch (e) {
        log(`Lecture par dates indisponible (${e.message}) : méthode standard`);
      }
    }
    let m = await sigs(origin, 1);
    const oldest = () => m.list[m.list.length - 1]?.time ?? 0;
    const inWindow = () => m.list.filter((x) => !x.err && x.time >= since && x.time <= until);
    while (!m.complete && m.pages < opts.maxHotPages && oldest() >= since && inWindow().length < cap) m = await sigs(origin, m.pages + 1);
    const all = inWindow();
    const pick = all.slice(0, cap);
    const txs = [];
    for (let i = 0; i < pick.length; i += 50) {
      const part = await Promise.all(pick.slice(i, i + 50).map((x) => rpc.tx(x.signature)));
      txs.push(...part.filter(Boolean));
      if (pick.length > 50) log(`Lecture des envois : ${Math.min(i + 50, pick.length)} / ${pick.length} transactions`);
    }
    const capped = all.length > cap || (!m.complete && oldest() >= since);
    return { txs, status: capped ? 'capped' : 'ok', coveredFrom: capped && pick.length ? pick[pick.length - 1].time : since };
  }

  // Suit l'argent de wallet en wallet : s'arrête au premier wallet qui a créé un token pump.fun.
  // On passe au wallet suivant seulement s'il reçoit au moins la moitié du montant.
  async function followFunds(address, lamports) {
    const path = [address];
    let cur = address;
    for (let hop = 0; ; hop++) {
      const s = await sigs(cur, 1);
      if (!s.complete) return { status: 'busy', end: cur, path };
      // les plus anciennes (la création suit souvent le financement) et les plus récentes
      const okList = s.list.filter((x) => !x.err);
      const pick = [...okList.slice(-30), ...okList.slice(0, 30)].filter((x, i, all) => all.findIndex((y) => y.signature === x.signature) === i);
      const txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature)))).filter(Boolean);
      const made = txs.filter((t) => t.create && t.signers.includes(cur)).sort((a, b) => (a.time || 0) - (b.time || 0));
      if (made.length) {
        return { status: 'created', end: cur, path, tokens: made.length, firstCreateAt: made[0].time || 0, creates: made.map((t) => ({ mint: t.create.mint, name: t.create.name, symbol: t.create.symbol, createdAt: t.time, creator: cur })) };
      }
      if (hop >= opts.maxFollow) break;
      const outs = new Map();
      // Un relais atomique reçoit et renvoie dans la même transaction, parfois sans signer lui-même :
      // on compte tout transfert sortant, sauf ceux d'un achat pump.fun (le SOL part alors vers la courbe).
      for (const t of txs) {
        for (const tr of t.pump ? t.transfers.filter((x) => x.top) : [...t.transfers, ...hiddenMoves(t, cur)]) if (tr.from === cur && tr.to !== cur) outs.set(tr.to, (outs.get(tr.to) || 0) + tr.lamports);
      }
      const next = [...outs.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!next || next[1] < 0.5 * lamports || path.includes(next[0])) break;
      const lab = labelOf(next[0]);
      if (lab) return { status: 'moved', end: cur, path, movedTo: lab.name };
      if (cluster.has(next[0])) return { status: 'cluster', end: next[0], path: [...path, next[0]] };
      cur = next[0];
      path.push(cur);
    }
    return { status: 'open', end: cur, path };
  }

  // Transactions d'un hot wallet entre deux dates, de la plus ancienne à la plus récente.
  async function windowTxs(hot, from, to, cap) {
    if (rpc.windowTxs) {
      try {
        const r = await rpc.windowTxs(hot, from, to, cap);
        if (r) return { txs: r.txs, status: r.capped ? 'capped' : 'ok' };
      } catch (e) {
        log(`Lecture par dates indisponible (${e.message}) : méthode standard`);
      }
    }
    let m = await sigs(hot, 1);
    const oldest = () => m.list[m.list.length - 1]?.time ?? 0;
    while (!m.complete && m.pages < opts.maxHotPages && oldest() >= from) m = await sigs(hot, m.pages + 1);
    if (!m.complete && oldest() > to) return { txs: [], status: 'out-of-reach' };
    const inWin = m.list.filter((x) => !x.err && x.time >= from && x.time <= to).reverse();
    const pick = inWin.slice(0, cap);
    const txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature)))).filter(Boolean);
    return { txs, status: inWin.length > cap ? 'capped' : !m.complete && oldest() > from ? 'partial' : 'ok' };
  }

  // Coup d'œil sur un destinataire : est-il neuf, a-t-il déjà lancé des tokens ?
  async function peekWallet(address, fundingSig) {
    const s = await sigs(address, 1);
    if (!s.complete) return { busy: true };
    const fresh = s.list.slice(-3).some((x) => x.signature === fundingSig);
    const pick = s.list.filter((x) => !x.err).slice(0, 40);
    const txs = (await Promise.all(pick.map((x) => rpc.tx(x.signature)))).filter(Boolean);
    return {
      fresh, txCount: s.list.length,
      tokens: txs.filter((t) => t.create && t.signers.includes(address)).length,
      lastTx: txs.reduce((mx, t) => Math.max(mx, t.time || 0), 0) || null,
    };
  }

  // ---------- soldes ----------
  log('Lecture des soldes');
  const bal = await rpc.balances([...cluster.keys()]);
  for (const w of cluster.values()) w.balance = bal[w.address] ?? 0;

  // ---------- 3. tokens ----------
  const tokens = new Map();
  for (const w of cluster.values()) {
    for (const c of w.creates) {
      if (!tokens.has(c.mint)) {
        tokens.set(c.mint, {
          mint: c.mint, name: c.name, symbol: c.symbol, uri: c.uri, creator: w.address, createdAt: c.time, createSig: c.sig,
          boughtSol: 0, soldSol: 0, fees: 0, tokensBought: 0, tokensSold: 0, tokensMoved: 0, firstSellAt: null, lastSellAt: null, traders: new Set(),
        });
      }
    }
  }
  for (const w of cluster.values()) {
    for (const m of w.tokenMoves) {
      const tk = tokens.get(m.mint);
      if (!tk) continue;
      tk.traders.add(w.address);
      if (m.delta > 0) {
        tk.tokensBought += m.delta;
        if (m.sol < 0) tk.boughtSol += -m.sol;
      } else if (m.sol > 100000) { // a reçu du SOL : c'est une vente
        tk.tokensSold += -m.delta;
        tk.soldSol += m.sol;
        tk.firstSellAt = Math.min(tk.firstSellAt ?? Infinity, m.time || Infinity);
        tk.lastSellAt = Math.max(tk.lastSellAt ?? 0, m.time || 0);
      } else {
        tk.tokensMoved += -m.delta; // sortie de tokens sans SOL en retour : transfert vers un autre wallet
      }
    }
  }

  // chaque réclamation de frais va au dernier token créé avant elle par ce wallet
  for (const w of cluster.values()) {
    const made = [...w.creates].sort((a, b) => (a.time || 0) - (b.time || 0));
    for (const c of w.feeClaims) {
      const tk = [...made].reverse().find((m) => (m.time || 0) <= (c.time || 0)) || made[made.length - 1];
      if (tk && tokens.has(tk.mint)) tokens.get(tk.mint).fees += c.lamports;
    }
  }

  const mints = [...tokens.keys()];
  let markets = {};
  if (mints.length) {
    log(`État du marché pour ${mints.length} token${mints.length > 1 ? 's' : ''}`);
    markets = await fetchMarkets(mints).catch(() => ({}));
  }

  const tokenList = [...tokens.values()].map((t) => {
    const market = markets[t.mint] || null;
    const soldPct = t.tokensBought > 0 ? Math.min(1, t.tokensSold / t.tokensBought) : 0;
    const movedPct = t.tokensBought > 0 ? Math.min(1, t.tokensMoved / t.tokensBought) : 0;
    const dead = market ? (market.marketCap ?? 0) < 15000 : null;
    let status;
    if (t.tokensBought === 0) status = 'no-buy';
    else if (soldPct >= 0.8) status = dead === false ? 'exit' : 'rug';
    else if (movedPct >= 0.5) status = 'moved';
    else status = 'holding';
    return {
      mint: t.mint, name: t.name, symbol: t.symbol, uri: t.uri, creator: t.creator, createdAt: t.createdAt, createSig: t.createSig,
      boughtSol: t.boughtSol / SOL, soldSol: t.soldSol / SOL, creatorFeesSol: t.fees / SOL, pnlSol: (t.soldSol - t.boughtSol + t.fees) / SOL,
      soldPct, movedPct,
      holdSeconds: t.lastSellAt && t.createdAt ? t.lastSellAt - t.createdAt : null,
      firstSellSeconds: t.firstSellAt && t.createdAt && Number.isFinite(t.firstSellAt) ? t.firstSellAt - t.createdAt : null,
      traders: [...t.traders], market, status,
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // ---------- résultat ----------
  const childCount = new Map();
  for (const e of edges) if (cluster.has(e.from) && cluster.has(e.to)) childCount.set(e.from, (childCount.get(e.from) || 0) + 1);
  // Wallet mère : celui qui finance le plus de wallets (au moins 2). Sinon, pas de mère identifiée.
  let mother = null;
  for (const [a, n] of childCount) if (n >= 2 && n > (childCount.get(mother) || 0)) mother = a;

  const tokensByCreator = new Map();
  for (const t of tokenList) {
    const arr = tokensByCreator.get(t.creator) || [];
    arr.push(t);
    tokensByCreator.set(t.creator, arr);
  }

  const noBal = leads.filter((l) => l.balanceSol == null);
  const leadBal = noBal.length ? await rpc.balances([...new Set(noBal.map((l) => l.end || l.address))]) : {};
  for (const l of noBal) l.balanceSol = (leadBal[l.end || l.address] ?? 0) / SOL;

  const wallets = [...cluster.values()].map((w) => {
    const mine = tokensByCreator.get(w.address) || [];
    return {
      link: w.link || null, funderLabel: (w.funder && labelOf(w.funder)?.name) || null,
      address: w.address, hop: w.hop, inChain: !!w.inChain, isStart: !!w.isStart, isRoot: w.address === rootAddr, isMother: w.address === mother,
      funder: w.funder, fundedSol: w.fundedLamports / SOL, fundedAt: w.fundedAt, fundSig: w.fundSig,
      txCount: w.txCount, truncated: w.truncated, firstTx: w.firstTx ?? null, lastTx: w.lastTx ?? null,
      balanceSol: w.balance / SOL, children: childCount.get(w.address) || 0,
      tokens: mine.length, rugs: mine.filter((t) => t.status === 'rug').length,
      // financé, encore du SOL, aucun token lancé : candidat au prochain lancement
      candidate: mine.length === 0 && w.balance >= 0.05 * SOL && (childCount.get(w.address) || 0) === 0,
    };
  });

  const rugs = tokenList.filter((t) => t.status === 'rug');
  const cashOut = cashList.map((c) => ({ address: c.address, kind: c.kind, label: c.label, depositOf: c.depositOf, sol: c.lamports / SOL, count: c.count, last: c.last, from: [...c.from] }));
  const chainAddrs = chain.map((c) => c.address).reverse();
  const pattern = deducePattern({ terminal, chain: chainAddrs, wallets, tokens: tokenList, cashouts: cashOut, fingerprints });
  log(`Schéma déduit : ${pattern.title}`);
  const tracker = recommendTracker({ wallets, fingerprints, chain: chainAddrs, terminal });
  const siblingTokensExtra = [];

  // ---------- 8 bis. recensement des sources : qui finance ses devs, avec quels montants ----------
  const creatorsAll = wallets.filter((w) => w.tokens > 0 && w.funder).map((w) => ({ address: w.address, funder: w.funder, fundedSol: w.fundedSol, fundedAt: w.fundedAt }));
  const infoMemo = new Map();
  const info = async (a) => {
    if (infoMemo.has(a)) return infoMemo.get(a);
    const w = cluster.get(a);
    let v = null;
    if (w) v = { funder: w.funder, fundedSol: w.fundedLamports / SOL, fundedAt: w.fundedAt, txCount: w.txCount, children: childCount.get(a) || 0 };
    else {
      const s = await sigs(a, 1);
      if (s.list.length <= 4) {
        const f = await findFunder(a);
        v = { funder: f.funder || null, fundedSol: (f.lamports || 0) / SOL, fundedAt: f.time ?? null, txCount: s.list.length };
      } else v = { funder: null, txCount: s.list.length };
    }
    infoMemo.set(a, v);
    return v;
  };
  const sources = creatorsAll.length ? await sourcesOf(creatorsAll, info) : [];
  let census = null;
  // la source qui finance le plus de devs ; à égalité, celle du dev qu'on trace
  const mine = (s) => s.devs.some((d) => d.address === start);
  // un exchange ne sert de source que si un même montant exact revient (règle F Project) ; sinon un wallet mère passe devant
  const usable = (s) => (s.labelType === 'exchange' || (terminal.hot && terminal.address === s.source) ? buildRanges(s.devs.map((d) => d.amount), TOL.exchange).some((r) => r.n >= 2) : true);
  let best = [...sources].filter((s) => s.devs.length >= 2).sort((a, b) => usable(b) - usable(a) || b.devs.length - a.devs.length || mine(b) - mine(a))[0] || null;
  // un seul dev connu : on fouille quand même les envois de sa source avec son montant (méthode F Project, mère comme exchange)
  if (!best) {
    const own = sources.find((s) => s.devs.some((d) => d.address === start));
    const me = own?.devs.find((d) => d.address === start);
    const big = own && (own.labelType === 'exchange' || (terminal.hot && terminal.address === own.source));
    // les exchanges sont déjà fouillés par l'empreinte de financement : ici, seulement les wallets mères
    let svc = false;
    if (own && !own.labelType && !big) {
      const ss = await sigs(own.source, 1);
      const act = activity(ss.list, !ss.complete);
      svc = ss.list.length >= 1000 && act.lastAt - act.firstAt < 3 * 3600; // service qui tourne : ses autres clients ne sont pas ses frères
      // wallet très riche et très actif : un exchange sans nom, ses autres clients ne sont pas ses frères non plus
      if (!svc && ss.list.length >= 1000) svc = (((await rpc.balances([own.source]).catch(() => ({})))[own.source] || 0) >= HOT_SOL * SOL);
    }
    if (own && me?.amount && !own.labelType && !big && !svc && !(cluster.get(start)?.creates.length >= 2)) {
      const now3 = opts.now || Math.floor(Date.now() / 1000);
      const helius = !rpc.perMethod;
      const tol0 = big ? TOL.exchange : TOL.mother;
      log(`Un seul dev connu : on cherche ses frères dans les envois de ${own.label || short(own.source)} à ${me.amount.toFixed(big || me.amount < 0.1 ? 4 : 2)} SOL`);
      const probe = await scanSource(own.source, buildRanges([me.amount], tol0), rpc, sigs, { from: now3 - (helius ? 72 : 24) * 3600, to: now3, cap: helius ? (big ? 20000 : 3000) : 300, maxFollow: helius ? 40 : 10, known: new Set([start]) }, log);
      const found = probe.creators.filter((c) => c.address !== start);
      if (found.length) {
        best = { ...own, devs: [...own.devs, ...found.map((c) => ({ address: c.address, amount: c.amount, at: c.at, relays: c.via.slice(1), probed: true }))] };
        best.probe = probe;
        log(`${found.length} frère${found.length > 1 ? 's' : ''} trouvé${found.length > 1 ? 's' : ''} : même source, même montant`);
      } else log('Aucun autre dev financé par cette source avec ce montant');
    }
  }
  if (best) {
    const isHot = terminal.hot && terminal.address === best.source;
    let kind = best.labelType === 'exchange' || isHot ? 'exchange' : best.labelType ? 'service' : 'mother';
    let activityInfo = null;
    if (kind === 'mother') {
      const s = await sigs(best.source, 1);
      activityInfo = activity(s.list, !s.complete);
      // des milliers de transactions en quelques heures, qui paie des centaines de wallets : un service qui tourne, pas un wallet mère
      if (s.list.length >= 1000 && activityInfo.lastAt - activityInfo.firstAt < 3 * 3600) kind = 'service';
      // des milliers de transactions et 300 SOL ou plus : un exchange sans nom, pas un wallet mère (plages à ±0,0001)
      else if (s.list.length >= 1000 && ((await rpc.balances([best.source]).catch(() => ({})))[best.source] || 0) >= HOT_SOL * SOL) { kind = 'exchange'; best.label = best.label || 'Exchange sans nom'; }
    }
    const tol = kind === 'exchange' ? TOL.exchange : TOL.mother;
    let ranges = buildRanges(best.devs.map((d) => d.amount), tol);
    if (kind === 'exchange') ranges = ranges.filter((r) => r.n >= 2); // un montant d'exchange ne compte que s'il se répète
    const fresh = best.devs.filter((d) => { const w = cluster.get(d.address); return w && w.firstTx != null && w.fundedAt != null && w.fundedAt <= w.firstTx + 5; }).length;
    // combien de temps ses devs mettent à lancer après avoir reçu le SOL (pour « Supprimer sans lancement »)
    const launchDelays = best.devs.map((d) => { const t = (tokensByCreator.get(d.address) || []).map((x) => x.createdAt).filter(Boolean); return t.length && d.at ? Math.min(...t) - d.at : null; }).filter((x) => x != null && x >= 0);
    census = {
      launchMaxMin: launchDelays.length ? Math.ceil(Math.max(...launchDelays) / 60) : null,
      source: best.source, label: best.label || (isHot ? 'Exchange sans nom' : null), kind, devs: best.devs, ranges,
      freshShare: best.devs.length ? fresh / best.devs.length : 0, sourceCreates: (tokensByCreator.get(best.source) || []).length, activity: activityInfo, others: sources.slice(0, 5).map((s) => ({ source: s.source, label: s.label, devs: s.devs.length })),
    };
    // le wallet mère change-t-il d'adresse ? l'ancien a tout envoyé au nouveau et avait lui aussi financé des devs
    if (kind === 'mother') {
      const fm = await findFunder(best.source).catch(() => ({}));
      if (fm?.funder && !labelOf(fm.funder)) {
        const prev = sources.find((x) => x.source === fm.funder && x.devs.length >= 1);
        const prevW = cluster.get(fm.funder);
        if (prev || (prevW && (childCount.get(fm.funder) || 0) >= 2 && prevW.balance < 0.05 * SOL)) census.rotation = { from: fm.funder, sol: (fm.lamports || 0) / SOL, at: fm.time ?? null };
      }
    }
    // la mère est-elle un intermédiaire jetable ? Au-dessus, un hub (qui reçoit de grosses sommes) envoie de petits
    // montants (ex. 7, 9, 3 SOL) à plusieurs intermédiaires, qui financent chacun des devs : c'est le hub qu'il faut suivre
    if (kind === 'mother' && !rpc.perMethod) {
      const sS = await sigs(best.source, 1);
      const disposable = sS.complete && sS.list.length <= 150;
      const fmH = disposable ? await findFunder(best.source).catch(() => null) : null;
      const H = fmH?.funder;
      if (H && !labelOf(H) && H !== start && !(cluster.get(H)?.creates?.length) && !census.rotation) {
        const sH = await sigs(H, 1);
        const actH = activity(sH.list, !sH.complete);
        const svcH = sH.list.length >= 1000 && actH.lastAt - actH.firstAt < 3 * 3600;
        if (!svcH) {
          log(`Sa mère ${short(best.source)} est jetable : on regarde qui l'a financée (${short(H)}) et ses autres envois`);
          const now4 = opts.now || Math.floor(Date.now() / 1000);
          const hub = await findHub(H, rpc, sigs, { from: now4 - 72 * 3600, to: now4, skip: new Set([best.source, ...best.devs.map((d) => d.address)]) }, log);
          if (hub.mids.length >= 1) {
            const motherAmount = (fmH.lamports || 0) / SOL;
            const midAmounts = [motherAmount, ...hub.mids.filter((m) => !m.direct).map((m) => m.amount)].filter((x) => x > 0);
            const devAmounts = [...best.devs.map((d) => d.amount), ...hub.mids.flatMap((m) => (m.direct ? [] : m.devs.map((d) => d.amount)))].filter((x) => x > 0);
            const directAmounts = hub.mids.filter((m) => m.direct).map((m) => m.amount);
            census.hub = {
              address: H, sends: hub.sends, followed: hub.followed,
              mids: [{ address: best.source, amount: motherAmount, devs: best.devs.length, current: true }, ...hub.mids.map((m) => ({ address: m.address, amount: m.amount, at: m.at, devs: m.devs.length, direct: !!m.direct }))],
              ranges: buildRanges([...midAmounts, ...directAmounts], TOL.mother, 3), devRanges: buildRanges(devAmounts, TOL.mother, 2),
              devs: best.devs.length + hub.mids.reduce((x, m) => x + m.devs.length, 0),
            };
            const have = new Set([...tokenList.map((t) => t.mint), ...siblingTokensExtra.map((t) => t.mint)]);
            for (const m of hub.mids) for (const d of m.devs) for (const t of d.creates) if (!have.has(t.mint)) { have.add(t.mint); siblingTokensExtra.push({ ...t, via: d.via, viaSource: H, fundedSol: d.amount }); }
            log(`Hub trouvé : ${short(H)} finance ${hub.mids.length + 1} intermédiaires qui ont financé ${census.hub.devs} devs`);
          } else log(`${short(H)} ne finance pas d'autres intermédiaires qui mènent à des devs`);
        }
      }
    }
    log(`Source de ses devs : ${census.label || short(best.source)} en a financé ${best.devs.length} (${ranges.map((r) => `${r.amount} SOL ×${r.n}`).join(', ') || 'montants tous différents'})`);
    // ses autres devs : on relit les envois de la source dans les plages, sur 72 h avec Helius
    if (best.probe && kind !== 'service') {
      const scan = best.probe;
      census.scan = { sends: scan.sends, followed: scan.followed, found: scan.creators.length, hitRate: scan.hitRate, windowTxs: scan.windowTxs };
      census.siblings = scan.creators.map((c) => ({ address: c.address, via: c.via, amount: c.amount, at: c.at, tokens: c.creates.length, known: c.known }));
      census.waiting = scan.waiting.filter((w) => !cluster.has(w.address)).slice(0, 10);
      const have = new Set([...tokenList.map((t) => t.mint), ...siblingTokensExtra.map((t) => t.mint)]);
      for (const c of scan.creators) for (const t of c.creates) if (!have.has(t.mint)) { have.add(t.mint); siblingTokensExtra.push({ ...t, via: c.via, viaSource: best.source, fundedSol: c.amount }); }
    } else if (ranges.length && kind !== 'service') {
      const now2 = opts.now || Math.floor(Date.now() / 1000);
      const helius = !rpc.perMethod;
      // un wallet mère se relit sur 7 jours (il envoie peu), un exchange sur 72 h (il envoie énormément)
      const hours = helius ? (kind === 'mother' ? 168 : 72) : 24;
      log(`Recherche de ses autres devs dans les envois de ${census.label || short(best.source)} (${hours >= 168 ? '7 jours' : `${hours} h`})`);
      const known = new Set(wallets.map((w) => w.address));
      const scan = await scanSource(best.source, ranges, rpc, sigs, { from: now2 - hours * 3600, to: now2, cap: helius ? 3000 : 300, maxFollow: helius ? 40 : 10, known }, log);
      census.scan = { sends: scan.sends, followed: scan.followed, found: scan.creators.length, hitRate: scan.hitRate, windowTxs: scan.windowTxs };
      census.siblings = scan.creators.map((c) => ({ address: c.address, via: c.via, amount: c.amount, at: c.at, tokens: c.creates.length, known: c.known }));
      census.waiting = scan.waiting.filter((w) => !cluster.has(w.address)).slice(0, 10);
      // les plages tiennent compte de tous ses devs connus (cluster + frères trouvés) : les montants les plus utilisés d'abord
      const allAmounts = [...best.devs.map((d) => d.amount), ...scan.creators.filter((c) => !best.devs.some((d) => d.address === c.address)).map((c) => c.amount)];
      let ranges2 = buildRanges(allAmounts, tol);
      if (kind === 'exchange') ranges2 = ranges2.filter((r) => r.n >= 2);
      if (ranges2.length) census.ranges = ranges2;
      if (census.waiting.length) log(`${census.waiting.length} wallet${census.waiting.length > 1 ? 's' : ''} financé${census.waiting.length > 1 ? 's' : ''} dans ses plages, encore rien lancé : ses prochains devs probables`);
      const have = new Set([...tokenList.map((t) => t.mint), ...siblingTokensExtra.map((t) => t.mint)]);
      for (const c of scan.creators) for (const t of c.creates) if (!have.has(t.mint)) { have.add(t.mint); siblingTokensExtra.push({ ...t, via: c.via, viaSource: best.source, fundedSol: c.amount }); }
      log(`${scan.creators.length} dev${scan.creators.length > 1 ? 's' : ''} trouvé${scan.creators.length > 1 ? 's' : ''} sur ${scan.followed} envois suivis dans les plages`);
    }
  }

  // le schéma suit le recensement : c'est la source qui finance le plus de devs qui le définit
  if (census && census.devs.length >= 2) {
    const nm = census.label || short(census.source);
    const relayed = census.devs.filter((d) => d.relays?.length).length;
    const amts = census.ranges.map((r) => r.amount).join(', ');
    const why = `${nm} a financé ${census.devs.length} de ses devs${relayed ? ` (${relayed} via des relais)` : ''}${amts ? `, avec ${amts} SOL` : ''}.`;
    if (census.kind === 'mother' && census.hub) Object.assign(pattern, { type: 'mother', title: 'Schéma hub (mère à deux étages)', summary: `Un hub (${short(census.hub.address)}) envoie de petits montants à des wallets intermédiaires jetables, qui financent chacun ses devs.`, confidence: census.hub.devs >= 3 ? 'high' : 'medium', reasons: [`${short(census.hub.address)} a financé ${census.hub.mids.length} intermédiaires (dont ${short(census.source)}), qui ont financé ${census.hub.devs} devs.`, why, ...pattern.reasons] });
    else if (census.kind === 'mother') Object.assign(pattern, { type: 'mother', title: 'Schéma wallet mère', summary: `Son wallet mère (${nm}) finance lui-même chaque nouveau dev.`, confidence: census.devs.length >= 3 ? 'high' : 'medium', reasons: pattern.type === 'mother' && pattern.summary.includes(short(census.source)) ? pattern.reasons : [why, ...pattern.reasons] });
    else if (census.kind === 'exchange') Object.assign(pattern, { type: 'exchange', title: 'Schéma exchange', summary: `Chaque dev est retiré à part de ${nm}${census.ranges.length ? ', toujours avec le même montant' : ''}.`, confidence: census.ranges.length ? 'high' : 'medium', reasons: [why, ...pattern.reasons] });
    else Object.assign(pattern, { type: 'mixer', title: 'Financé par un service', summary: `Ses devs sortent d'un service de paiement (${nm}) qui change régulièrement de wallet.`, confidence: 'medium', reasons: [why, ...pattern.reasons] });
  }

  // ---------- 9. après : où part l'argent de l'adresse tracée ----------
  log(`Après : on suit l'argent envoyé par ${short(start)}`);
  const fwd = await followForward(start, rpc, sigs, opts.forward || FORWARD.normal, log);
  const known = new Set(tokenList.map((t) => t.mint));
  const afterCreates = fwd.creates.filter((c) => !known.has(c.mint));
  for (const c of afterCreates) known.add(c.mint);
  const afterBuys = fwd.groupBuys.filter((b) => !known.has(b.mint));
  const afterMints = [...afterCreates.map((c) => c.mint), ...afterBuys.map((b) => b.mint)];
  const afterMarkets = afterMints.length ? await fetchMarkets(afterMints).catch(() => ({})) : {};
  const after = [
    ...afterCreates.map((c) => {
      const market = afterMarkets[c.mint] || null;
      const dead = market ? (market.marketCap ?? 0) < 15000 : null;
      const status = c.boughtSol === 0 ? 'no-buy' : c.soldSol > 0 ? (dead === false ? 'exit' : 'rug') : 'holding';
      const route = forwardRoute(fwd.nodes, c.creator);
      return { ...c, pnlSol: c.soldSol - c.boughtSol + (c.creatorFeesSol || 0), holdSeconds: c.lastSellAt && c.createdAt ? c.lastSellAt - c.createdAt : null, market, status, side: 'after', route, logic: routeLogic(route, 'after') };
    }),
    ...afterBuys.map((b) => {
      const market = afterMarkets[b.mint] || null;
      const route = forwardRoute(fwd.nodes, b.buyers[0]);
      return { mint: b.mint, name: market?.name || 'Token inconnu', symbol: market?.symbol || '', creator: null, createdAt: b.firstAt, groupBuy: true, buyers: b.buyers.length, groupSol: b.sol, market, status: 'group', side: 'after', route, logic: routeLogic(route, 'after', { groupBuy: true, buyers: b.buyers.length }) };
    }),
  ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  log(`Après : ${fwd.nodes.length} wallets suivis, ${afterCreates.length} nouveau${afterCreates.length > 1 ? 'x' : ''} token${afterCreates.length > 1 ? 's' : ''} créé${afterCreates.length > 1 ? 's' : ''}, ${afterBuys.length} acheté${afterBuys.length > 1 ? 's' : ''} en groupe`);

  // route et logique pour chaque token d'avant
  const roleOf = (a) => {
    const w = cluster.get(a);
    if (!w) return labelOf(a) ? 'exchange' : 'wallet';
    if ((tokensByCreator.get(a) || []).length) return 'creator';
    if (w.txCount <= 4) return 'relay';
    if (a === mother) return 'mother';
    return 'wallet';
  };
  // avant / après : par rapport au premier lancement de l'adresse tracée (sinon son financement)
  const ownTimes = (tokensByCreator.get(start) || []).map((t) => t.createdAt).filter(Boolean);
  const startRef = ownTimes.length ? Math.min(...ownTimes) : chain[0]?.time ?? 0;
  const inFwd = new Set(fwd.nodes.map((n) => n.address));
  for (const t of tokenList) {
    t.side = t.creator === start ? 'self' : (t.createdAt || 0) > startRef ? 'after' : 'before';
    if (t.side === 'after' && inFwd.has(t.creator)) {
      t.route = forwardRoute(fwd.nodes, t.creator);
      t.logic = routeLogic(t.route, 'after');
    } else {
      t.route = clusterRoute(start, t.creator, edges, roleOf);
      t.logic = routeLogic(t.route, 'before');
    }
  }

  // le gros de son argent, de wallet en wallet, jusqu'à là où il est maintenant
  const flow = await followMainFlow(start, rpc, sigs, { maxHops: opts.forward?.maxNodes >= 100 ? 120 : 60 }, log);
  log(`Chemin de l'argent : ${flow.path.length} wallets, ${{ rest: 'posé', mixer: 'mélangeur', exchange: 'exchange', split: 'éparpillé', spent: 'dépensé', max: 'bouge encore', launched: 'relancé dans un nouveau token' }[flow.end] || flow.end}`);
  // les tokens lancés par les devs suivants, trouvés sur le chemin de l'argent : la chaîne continue
  const flowNew = (flow.creates || []).filter((c) => !known.has(c.mint));
  if (flowNew.length) {
    for (const c of flowNew) known.add(c.mint);
    const fm = await fetchMarkets(flowNew.map((c) => c.mint)).catch(() => ({}));
    for (const c of flowNew) {
      const market = fm[c.mint] || null;
      after.push({ ...c, boughtSol: null, soldSol: null, pnlSol: 0, market, status: market && (market.marketCap ?? 0) >= 15000 ? 'exit' : 'rug', side: 'after', viaFlow: true, logic: 'Lancé par un dev suivant de la chaîne, trouvé en suivant le gros de son argent.' });
    }
    after.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    log(`Chemin de l'argent : ${flowNew.length} token${flowNew.length > 1 ? 's' : ''} lancé${flowNew.length > 1 ? 's' : ''} par les devs suivants`);
  }
  // où est l'argent maintenant : les wallets suivis qui ont encore du SOL
  const holders = fwd.nodes.filter((n) => !['relay', 'exchange', 'service'].includes(n.kind) && n.address !== start);
  const holderBal = holders.length ? await rpc.balances(holders.map((n) => n.address)).catch(() => ({})) : {};
  const moneyNow = holders.map((n) => ({ address: n.address, kind: n.kind, balanceSol: (holderBal[n.address] || 0) / SOL, txCount: n.txCount, route: forwardRoute(fwd.nodes, n.address) }))
    .filter((n) => n.balanceSol >= 1).sort((a, b) => b.balanceSol - a.balanceSol).slice(0, 5);
  // schéma araignée : la mère découpe une somme en parts égales vers des wallets neufs, qui renvoient tout au dev
  const firstOwn = (tokensByCreator.get(start) || []).map((t) => t.createdAt).filter(Boolean);
  const spider = await detectSpider(rpc, start, firstOwn.length ? Math.min(...firstOwn) : null).catch(() => null);
  if (spider) {
    log(`Schéma araignée : ${spider.legs.length} wallets neufs × ${spider.legSol.toFixed(3)} SOL, tous financés par ${short(spider.mother)}`);
    Object.assign(pattern, { type: 'spider', title: 'Schéma araignée (mère → pattes → dev)', summary: 'Un wallet mère découpe une somme en parts égales vers des wallets neufs, qui renvoient tous leur part au dev.', confidence: 'high',
      reasons: [`${spider.legs.length} wallets neufs ont envoyé chacun environ ${spider.legSol.toFixed(3)} SOL au dev (${spider.total.toFixed(2)} SOL en tout), en quelques minutes.`, `Tout part de ${short(spider.mother)} (${spider.motherTx >= 1000 ? 'plus de 1 000' : spider.motherTx} transactions) : ${spider.momSol.toFixed(4)} SOL envoyés dans la toile, qui traversent ${spider.depth} wallets jetables avant d’arriver au dev.`, ...pattern.reasons] });
  }
  const advice = adviseBot({ start, base: tracker, spider, fwd, after: [...tokenList.filter((t) => t.side === 'after'), ...after], census, history: opts.history || [], startTokens: (tokensByCreator.get(start) || []).length, startBalanceSol: (cluster.get(start)?.balance ?? 0) / SOL, startActivity: cluster.get(start) ? { signed: cluster.get(start).signed ?? null, txCount: cluster.get(start).txCount ?? 0, failed: cluster.get(start).failedCount ?? 0, mainSigner: cluster.get(start).mainSigner ?? null } : null, flow, now: opts.now || Math.floor(Date.now() / 1000) });
  // il relance lui-même depuis la même adresse : c'est ça son schéma, quel que soit l'endroit d'où vient son SOL
  const ownCreates = (tokensByCreator.get(start) || []).length;
  if (ownCreates >= 2 && pattern.type !== 'serial') Object.assign(pattern, { type: 'serial', title: 'Même adresse réutilisée', summary: `Il a lancé ${ownCreates} tokens depuis cette même adresse, sans en changer.`, confidence: 'high', reasons: [`Son SOL d'origine : ${pattern.title.toLowerCase()}.`, ...pattern.reasons] });
  if (advice.notDev) Object.assign(pattern, { type: 'none', title: 'Pas un dev', summary: 'Cette adresse ne signe aucune transaction : elle ne lance rien et n’envoie rien.', confidence: 'high', reasons: [advice.reason] });
  const forward = { nodes: fwd.nodes.map(({ address, parent, kind, inSol, inAt, txCount, outCount, creates }) => ({ address, parent, kind, inSol, inAt, txCount, outCount, creates })), truncated: fwd.truncated };
  const ownMints = new Set(tokenList.map((t) => t.mint));
  const siblingTokens = [];
  for (const l of leads) for (const c of l.creates || []) if (!ownMints.has(c.mint)) { ownMints.add(c.mint); siblingTokens.push(c); }
  for (const c of siblingTokensExtra) if (!ownMints.has(c.mint)) { ownMints.add(c.mint); siblingTokens.push(c); }
  // état du marché des tokens de ses autres devs : mort ou encore en vie
  if (siblingTokens.length) {
    const sm = await fetchMarkets(siblingTokens.map((t) => t.mint)).catch(() => ({}));
    for (const t of siblingTokens) { t.market = sm[t.mint] || null; t.status = t.market ? ((t.market.marketCap ?? 0) < 15000 ? 'dead' : 'alive') : 'dead'; }
  }
  // dernier token lancé par lui ou par un de ses autres devs
  const lastLaunchAt = lastLaunchOf({ tokens: tokenList, after, siblingTokens });
  const nowSec = opts.now || Math.floor(Date.now() / 1000);
  if (lastLaunchAt && nowSec - lastLaunchAt > INACTIVE_AFTER) {
    const days = Math.floor((nowSec - lastLaunchAt) / 86400);
    advice.inactive = true;
    advice.inactiveReason = `Ni lui ni ses autres devs n'ont lancé de token depuis ${days} jour${days > 1 ? 's' : ''}. Il ne t'intéresse pas pour l'instant : relance une traque s'il revient.`;
    log(`Inactif : dernier token il y a ${days} j`);
  }
  const result = {
    start, fromToken, createdAt: Date.now(), options: opts, lastLaunchAt,
    terminal, root: rootAddr, mother,
    chain: chainAddrs, pattern, tracker, advice, census, spider, after, moneyNow, forward, siblingTokens, fingerprints,
    flow: { end: flow.end, frontier: flow.frontier, creates: (flow.creates || []).map(({ mint, symbol, creator, createdAt }) => ({ mint, symbol, creator, createdAt })), path: flow.path.map(({ address, kind, inSol, inAt, outSol, outAt, txCount, bursts, reused, label, merged, loop, creates }) => ({ address, kind, inSol, inAt, outSol, outAt, txCount, bursts, reused, label, merged, loop, creates: creates?.map((c) => c.mint) })) },
    wallets, edges: edges.filter((e) => cluster.has(e.to)).map((e) => ({ ...e, sol: e.lamports / SOL, fromLabel: labelOf(e.from)?.name || null })),
    leads, exchangeScan,
    tokens: tokenList,
    cashouts: cashOut,
    stats: {
      wallets: wallets.length,
      tokens: tokenList.length,
      rugs: rugs.length,
      holding: tokenList.filter((t) => t.status === 'holding').length,
      pnlSol: tokenList.reduce((s, t) => s + t.pnlSol, 0),
      cashoutSol: cashList.reduce((s, c) => s + c.lamports, 0) / SOL,
      candidates: wallets.filter((w) => w.candidate).length,
      skippedChildren, skippedLinked,
      linked: wallets.filter((w) => w.link).length,
      leads: leads.length,
      depositSol: cashList.filter((c) => c.depositOf || c.kind === 'exchange').reduce((s, c) => s + c.lamports, 0) / SOL,
      rpcCalls: rpc.calls, cacheHits: rpc.cacheHits,
    },
  };
  log(`Terminé : ${wallets.length} wallets, ${tokenList.length} tokens, ${rugs.length} rug${rugs.length > 1 ? 's' : ''} probable${rugs.length > 1 ? 's' : ''}`);
  return result;
}

function newWallet(address, extra) {
  return {
    address, hop: 0, inChain: false, funder: null, fundedLamports: 0, fundedAt: null, fundSig: null,
    txCount: 0, truncated: false, receivedLamports: 0, balance: 0,
    creates: [], tokenMoves: [], feeClaims: [], out: [], ...extra,
  };
}

const HOT_SOL = 300; // au-delà, un wallet très actif sans nom est traité comme un exchange (un wallet mère garde rarement autant)
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '?');
const fmtSol = (lamports) => (lamports / SOL).toFixed(lamports >= SOL ? 2 : 3);

// Déduit le schéma du dev à partir de ce qui a été trouvé, avec les raisons et ce qu'il faut surveiller.
function deducePattern({ terminal, chain, wallets, tokens, cashouts, fingerprints }) {
  const by = new Map(wallets.map((w) => [w.address, w]));
  const s4 = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const fr = (n, d) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const de = (x) => (x.startsWith('un ') ? `d'${x}` : `de ${x}`);
  const creators = wallets.filter((w) => w.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const chainW = chain.map((a) => by.get(a)).filter(Boolean);
  const chainCreators = chainW.filter((w) => w.tokens > 0);
  const relays = chainW.filter((w) => !w.isStart && w.tokens === 0 && w.children <= 1);
  const mother = wallets.filter((w) => w.children >= 2).sort((a, b) => b.children - a.children)[0] || null;
  const motherKids = mother ? wallets.filter((w) => w.funder === mother.address) : [];
  const motherDevs = motherKids.filter((w) => w.tokens > 0);
  const fromExchange = terminal.type === 'exchange' || terminal.type === 'service' || !!terminal.hot;
  const fromBusy = terminal.type === 'busy' && !terminal.hot;
  const sourceName = terminal.hot ? `un exchange sans nom (${s4(terminal.address)}, ${Math.round(terminal.balanceSol).toLocaleString('fr-FR')} SOL)`
    : fromExchange ? terminal.label : fromBusy ? `un wallet à très forte activité (${s4(terminal.address)})` : null;
  const exDeposits = cashouts.filter((c) => c.depositOf || c.kind === 'exchange');
  const depositSol = exDeposits.reduce((s, c) => s + c.sol, 0);
  const collectors = wallets.filter((w) => w.link?.type === 'collects');
  const sameDeposit = wallets.filter((w) => w.link?.type === 'deposit');
  const exFunded = wallets.filter((w) => w.funderLabel);
  const candidates = wallets.filter((w) => w.candidate);
  const bestFp = fingerprints.filter((f) => f.verified >= 3).sort((a, b) => b.rate - a.rate)[0] || null;
  const reasons = [];
  const watch = [];
  let type, title, summary, confidence;

  if (mother && motherDevs.length <= 1 && motherKids.length >= 10 && chainCreators.length < 2) {
    // paie des dizaines de wallets d'un coup, aucun autre dev parmi eux : service de mélange partagé, pas un wallet mère
    type = 'mixer';
    title = 'Financé par un mélangeur';
    summary = `Son SOL sort d'un service de mélange (${s4(mother.address)}) qui paie des dizaines de wallets d'un coup, puis passe par des relais jusqu'au dev.`;
    reasons.push(`${s4(mother.address)} a payé ${pl(motherKids.length, 'wallet', 'wallets')} en même temps, dont ${motherDevs.length ? 'un seul' : 'aucun'} a créé un token : c'est un service partagé, pas un wallet à lui.`);
    const relaysUp = chainW.filter((w) => !w.isStart && w.tokens === 0 && w.children <= 1).length;
    if (relaysUp) reasons.push(`Entre le mélangeur et le dev : ${pl(relaysUp, 'wallet relais', 'wallets relais')} jetables.`);
    watch.push('Rien de fixe à surveiller en amont : chaque dev sort du mélangeur par un chemin différent.');
    confidence = 'medium';
  } else if (mother && motherDevs.length >= 2) {
    type = 'mother';
    title = 'Schéma wallet mère';
    summary = `Un wallet central (${s4(mother.address)}) alimente lui-même les wallets de dev.`;
    reasons.push(`${s4(mother.address)} a financé ${pl(motherKids.length, 'wallet', 'wallets')}, dont ${motherDevs.length} ${motherDevs.length > 1 ? 'ont' : 'a'} créé des tokens.`);
    const amts = motherKids.map((w) => w.fundedSol).sort((a, b) => a - b);
    reasons.push(amts[amts.length - 1] - amts[0] < 0.002
      ? `Il envoie toujours le même montant : ${fr(amts[0], 3)} SOL.`
      : `Les montants envoyés varient de ${fr(amts[0], 2)} à ${fr(amts[amts.length - 1], 2)} SOL : c'est le lien de financement qui le trahit, pas le montant.`);
    if (sourceName) reasons.push(`Le wallet mère est lui-même alimenté par ${sourceName}.`);
    watch.push(`Tout nouveau wallet financé par ${s4(mother.address)} : c'est le prochain dev.`);
    if (candidates.length) watch.push(`${pl(candidates.length, 'wallet déjà financé et pas encore utilisé', 'wallets déjà financés et pas encore utilisés')} : ${candidates.slice(0, 3).map((w) => s4(w.address)).join(', ')}.`);
    confidence = motherDevs.length >= 3 ? 'high' : 'medium';
  } else if (chainCreators.length >= 2) {
    type = 'chain';
    title = 'Schéma en chaîne (dev vers dev)';
    summary = 'Chaque wallet de dev finance le suivant avec ses gains.';
    reasons.push(`${chainCreators.length} wallets qui se financent l'un l'autre ont créé des tokens : ${chainCreators.map((w) => s4(w.address)).join(' → ')}.`);
    if (sourceName) reasons.push(`Le premier wallet de la chaîne vient ${de(sourceName)}.`);
    if (relays.length) reasons.push(`Entre deux devs, l'argent passe par ${pl(relays.length, 'wallet relais', 'wallets relais')} qui renvoient tout aussitôt.`);
    if (mother && motherKids.length >= 10 && motherDevs.length <= 1) reasons.push(`Au départ, son SOL sort d'un service de mélange (${s4(mother.address)}, ${motherKids.length} wallets payés d'un coup).`);
    const last = [...wallets].filter((w) => !w.link).sort((a, b) => (b.fundedAt || 0) - (a.fundedAt || 0))[0];
    if (last) watch.push(`Le dernier wallet de la chaîne (${s4(last.address)}) : son prochain envoi de SOL vers un wallet neuf désigne le prochain dev.`);
    confidence = chainCreators.length >= 3 ? 'high' : 'medium';
  } else if (fromExchange || exFunded.length) {
    type = 'exchange';
    const name = sourceName || exFunded[0].funderLabel;
    title = 'Schéma exchange';
    summary = `Chaque wallet de dev est alimenté à part par ${name}, sans lien direct entre les wallets.`;
    const top = chainW[0];
    if (top?.funder) reasons.push(`${s4(top.address)} a reçu ${fr(top.fundedSol, 3)} SOL ${de(name)}.`);
    if (relays.length) reasons.push(`L'argent passe par ${pl(relays.length, 'wallet relais', 'wallets relais')} avant d'arriver au dev.`);
    if (sameDeposit.length) reasons.push(`${pl(sameDeposit.length, 'autre wallet dépose', 'autres wallets déposent')} sur la même adresse de dépôt : même compte d'exchange.`);
    if (exDeposits.length) reasons.push(`${fr(depositSol, 2)} SOL de gains repartent vers ${[...new Set(exDeposits.map((c) => c.depositOf || c.label))].join(', ')}.`);
    if (creators.length <= 1 && !sameDeposit.length) reasons.push('Un seul wallet de dev connu pour l\'instant : les autres sont cachés derrière la source.');
    if (bestFp) reasons.push(`Sur ${pl(bestFp.verified, 'envoi suivi', 'envois suivis')} de ${fr(bestFp.sol, 3)} SOL depuis ${bestFp.name}, ${bestFp.creators} ${bestFp.creators > 1 ? 'mènent' : 'mène'} à un créateur de token (${Math.round(bestFp.rate * 100)} %).`);
    for (const f of fingerprints) {
      if (f.verdict === 'reliable' || f.verdict === 'medium') watch.push(`Les envois de ${fr(f.sol, 3)} SOL (±${fr(f.tolSol, 3)}) depuis ${f.name} : ${pl(f.waiting, 'wallet en attente', 'wallets en attente')} en ce moment.`);
      else if (f.verdict === 'weak') watch.push(`Le montant ${fr(f.sol, 3)} SOL est trop courant chez ${f.name} pour servir de filtre.`);
      else watch.push(`Les prochains envois de ${fr(f.sol, 3)} SOL (±${fr(f.tolSol, 3)}) depuis la source : ${f.sends ? pl(f.sends, 'autre repéré', 'autres repérés') : 'aucun autre'} sur les ${fr(f.coveredHours, 1)} h lues, trop peu pour juger.`);
    }
    if (exDeposits.length) watch.push(`L'adresse de dépôt ${s4(exDeposits[0].address)} : tout wallet qui y dépose appartient au même compte.`);
    confidence = bestFp?.verdict === 'reliable' || sameDeposit.length ? 'high' : exDeposits.length || relays.length || bestFp?.verdict === 'medium' ? 'medium' : 'low';
  } else if (creators[0]?.tokens >= 2) {
    type = 'serial';
    title = 'Même adresse réutilisée';
    summary = 'Un seul wallet crée tous les tokens, sans changer d\'adresse.';
    watch.push(`${s4(creators[0].address)} lui-même : il relance depuis la même adresse.`);
    confidence = 'medium';
  } else {
    type = 'unknown';
    title = fromBusy ? 'Source non identifiée' : 'Schéma non identifié';
    summary = fromBusy ? 'Financé par un wallet très actif sans label : ni exchange confirmé, ni wallet mère.' : 'Pas assez de liens trouvés pour conclure.';
    confidence = 'low';
  }

  if (creators[0]?.tokens >= 5) reasons.push(`Lanceur en série : ${s4(creators[0].address)} a créé ${creators[0].tokens} tokens à lui seul.`);
  if (collectors.length) {
    reasons.push(`Les gains sont regroupés sur ${pl(collectors.length, 'wallet de collecte', 'wallets de collecte')} : ${collectors.slice(0, 3).map((w) => s4(w.address)).join(', ')}.`);
    watch.push(`Les sorties de ${s4(collectors[0].address)} : c'est là que l'argent se rassemble avant de repartir.`);
  }
  const busyOut = cashouts.filter((c) => c.kind === 'busy' && c.sol >= 1).sort((a, b) => b.sol - a.sol)[0];
  if (busyOut) reasons.push(`${fr(busyOut.sol, 1)} SOL partent vers un wallet à très forte activité (${s4(busyOut.address)}) : exchange ou bot probable.`);
  if (tokens.length) {
    const rugs = tokens.filter((t) => t.status === 'rug').length;
    reasons.push(`${pl(tokens.length, 'token créé', 'tokens créés')}, dont ${pl(rugs, 'rug probable', 'rugs probables')}.`);
  }
  if (!watch.length) watch.push('Relance la traque plus tard ou en mode plus profond : rien de précis à surveiller pour l\'instant.');
  return { type, title, summary, confidence, reasons, watch };
}

// Que faut-il suivre ? Règles reprises de la méthode F Project :
// - même exchange + même montant chez au moins 2 autres créateurs -> on suit l'adresse de l'exchange, plage de ±0,0001 SOL ;
// - wallet mère qui finance plusieurs devs -> on suit le wallet mère ;
// - une adresse qui relance (2 créations ou plus) n'est jamais un tracker ;
// - une source sans label d'exchange n'est pas un tracker exchange.
function recommendTracker({ wallets, fingerprints, chain = [], terminal = {} }) {
  const fr = (n, d) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const s4 = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  const options = ['keepAddress', 'freshWalletOnly', 'removeIfNoLaunch'];
  // 1. exchange + même montant chez au moins 2 autres créateurs
  const fp = fingerprints.filter((f) => (f.kind === 'exchange' || f.kind === 'hot') && f.creators >= 2).sort((a, b) => b.creators - a.creators)[0];
  if (fp) {
    const bs = (fp.bySource || []).filter((b) => b.creators > 0).sort((a, b) => b.creators - a.creators || b.main - a.main);
    const main = bs[0]?.address || fp.source;
    const extra = bs.filter((b) => b.address !== main);
    const multi = extra.length ? ` Ses devs sortent aussi de ${extra.map((b) => `${s4(b.address)} (${b.creators})`).join(', ')}, un autre hot wallet ${fp.name} : mets un 2e tracker sur cette adresse avec la même plage.` : '';
    return {
      verdict: 'track', kind: 'cex', address: main, alsoTrack: extra.map((b) => b.address), multi, name: fp.kind === 'hot' ? 'Exchange sans nom' : fp.name, minSol: r4(fp.sol - 0.0001), maxSol: r4(fp.sol + 0.0001), options,
      reason: `${fp.creators} autres wallets financés par ${fp.name === 'Exchange sans nom' ? `un exchange sans nom (${fp.source.slice(0, 4)}…${fp.source.slice(-4)}, très actif et très riche)` : fp.name === 'Exchange' ? `un exchange (${fp.source.slice(0, 4)}…${fp.source.slice(-4)})` : fp.name} avec le même montant exact, ${fr(fp.sol, 4)} SOL, ont lancé un token. On suit l'exchange avec une plage à ±0,0001 SOL, pas le dev jetable.${fp.name === 'Exchange sans nom' ? ' Vérifie sur Solscan que c’est bien un exchange avant de le mettre dans le bot.' : ''}${multi}`,
      warning: fp.kind === 'hot' ? 'Cet exchange n\'a pas de nom connu : vérifie sur Solscan que c\'est bien un exchange avant de le mettre dans le bot.' : null,
    };
  }
  // 2. wallet mère qui finance plusieurs devs
  const mother = wallets.find((w) => w.isMother);
  if (mother) {
    const devKids = wallets.filter((w) => w.funder === mother.address && w.tokens > 0);
    if (devKids.length >= 2) {
      const amts = devKids.map((w) => w.fundedSol);
      const tight = Math.max(...amts) - Math.min(...amts) < 0.002;
      return {
        verdict: 'track', kind: 'mother', address: mother.address, name: 'Wallet mère',
        minSol: r4(Math.min(...amts) - 0.0001), maxSol: r4(Math.max(...amts) + 0.0001), options,
        reason: `${devKids.length} wallets financés par ce wallet ont lancé un token.${tight ? '' : ' Les montants varient : la plage couvre tous ceux déjà vus.'}`,
      };
    }
  }
  // 3. chaîne dev -> dev : on suit le dernier wallet, le bot passe au suivant tout seul (keepAddress)
  const by = new Map(wallets.map((w) => [w.address, w]));
  const chainDevs = chain.map((a) => by.get(a)).filter((w) => w && w.tokens > 0);
  if (chainDevs.length >= 2 && !chainDevs.some((w) => w.tokens >= 2)) {
    const last = chainDevs[chainDevs.length - 1];
    const firstIdx = chain.indexOf(chainDevs[0].address);
    const relays = chain.slice(firstIdx).map((a) => by.get(a)).filter((w) => w && !w.tokens).length;
    return {
      relays,
      warning: relays ? `Entre deux devs, l'argent passe par ${relays > 1 ? 'un wallet relais à chaque fois' : 'un wallet relais'} qui renvoie tout aussitôt : le prochain dev sera financé via un relais, pas directement.` : null,
      verdict: 'track', kind: 'chain', address: last.address, name: 'Dernier dev de la chaîne', minSol: null, maxSol: null, options: ['keepAddress', 'freshWalletOnly'],
      reason: `${chainDevs.length} devs se financent l'un l'autre. Le bot suit ${s4(last.address)} et passe au prochain wallet neuf qu'il finance.`,
    };
  }
  const start = wallets.find((w) => w.isStart);
  if (start?.tokens >= 2) return { verdict: 'reject', reason: `Même adresse réutilisée (${start.tokens} créations) : jamais un tracker. Pour le snipe, mets plutôt cette adresse en copytrade.` };
  // 4. exchange trouvé mais montant pas encore confirmé
  const ex = fingerprints.find((f) => f.kind === 'exchange' || f.kind === 'hot');
  if (ex) {
    const span = ex.coveredHours < 6 ? ` Seulement ${fr(ex.coveredHours, 1)} h d'envois lues : avec une clé Helius on lit 24 h.` : '';
    const same = fingerprints.filter((f) => f.source === ex.source);
    // hots : un vieux hot wallet qui n'envoie plus rien ne compte pas
    const scan = { hours: ex.windowHours, covered: ex.coveredHours, amounts: same.map((f) => f.sol), hots: (ex.bySource || []).filter((b) => b.main || b.read >= 100).length || 1, read: (ex.bySource || []).reduce((n, b) => n + b.read, 0) || ex.txRead };
    return {
      verdict: 'dig', kind: 'cex', address: ex.source, name: ex.name, minSol: r4(ex.sol - 0.0001), maxSol: r4(ex.sol + 0.0001), options, scan,
      reason: `Financé par ${ex.name} avec ${fr(ex.sol, 4)} SOL, mais ${ex.creators === 1 ? 'un seul autre wallet' : 'aucun autre wallet'} à ce montant n'a lancé de token.${span} Ne pas tracker le wallet du dev, il est jetable.`,
    };
  }
  if (terminal.type === 'busy') return { verdict: 'reject', reason: 'Financé par un wallet très actif sans nom : ni exchange confirmé, ni wallet mère. Rien de fiable à mettre dans le bot.' };
  return { verdict: 'reject', reason: 'Aucun schéma de financement réutilisable trouvé.' };
}
