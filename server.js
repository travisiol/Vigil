import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, createReadStream, statSync } from 'node:fs';
import { Cache } from './src/cache.js';
import { Rpc, rpcConfigFromEnv } from './src/rpc.js';
import { trace, PRESETS } from './src/tracer.js';
import { scan, SCAN_DEFAULTS } from './src/scanner.js';
import { qualify, RULE as QUAL_RULE } from './src/qualify.js';
import { hunt, HUNT_DEFAULTS } from './src/hunt.js';
import { findSnipers, analyseWallet } from './src/snipers.js';
import { walletHunt } from './src/wallethunt.js';
import { analyseCopyWallet } from './src/wallettracker.js';
import { filterHunt } from './src/filterhunt.js';
import { createsOf } from './src/hunt.js';
import { realReport } from './src/realpnl.js';
import { isAddress } from './src/parse.js';
import { lastLaunchOf, teamKeys } from './src/advice.js';
import { LABELS, setLocalLabel } from './src/labels.js';
import { ExchangeWatch, EXWATCH } from './src/exwatch.js';
import { exchangeDossier } from './src/exsnipe.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 4477;
const DATA = path.join(ROOT, 'data');
const INV = path.join(DATA, 'investigations');
const BUY_SOL = 0.15; // mise par trade du user, pour le résultat affiché dans la liste
const PUBLIC = path.join(ROOT, 'public');
mkdirSync(INV, { recursive: true });

const cfg = rpcConfigFromEnv();
const cache = new Cache(DATA);
const jobs = new Map(); // id -> { events, listeners, done }

// ---------- surveillance exchange ----------
// Chaque rugger financé par un exchange est surveillé en continu : un wallet neuf qui reçoit son montant exact = son prochain dev.
const exwatch = new ExchangeWatch({ file: path.join(DATA, 'exchange-watch.json'), rpc: () => new Rpc({ ...cfg, cache }), log: (m) => console.log(m) });
// ---------- snipe exchange : le dossier complet d'un rugger exchange ----------
const EXD = path.join(DATA, 'exdossiers');
mkdirSync(EXD, { recursive: true });
const exdPath = (start) => path.join(EXD, `${start}.json`);
const exJobs = new Map();
function exSummary(d) {
  return {
    start: d.start, symbol: d.symbol, kind: d.kind, exchange: d.exchange || null, hot: d.hot || null, status: d.verdict?.status || null, title: d.verdict?.title || null,
    amounts: (d.watchAmounts || []).map((a) => ({ sol: a.sol, kind: a.kind })), bundle: (d.bundle || []).length, mine: (d.mine || []).length,
    others: (d.others || []).length, devs: new Set((d.fundings || []).map((f) => f.dev)).size, createdAt: d.createdAt,
  };
}
function listDossiers() {
  return readdirSync(EXD).filter((f) => f.endsWith('.json')).map((f) => { try { return exSummary(JSON.parse(readFileSync(path.join(EXD, f), 'utf8'))); } catch { return null; } }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
function startExSnipe(address) {
  for (const j of exJobs.values()) if (j.address === address && !j.done) return j.id;
  const id = `ex-${Date.now().toString(36)}`;
  const job = { id, address, logs: [], done: false, error: null, start: null, startedAt: Date.now() };
  exJobs.set(id, job);
  const emit = (e) => { if (e.type === 'log') { job.logs.push(e.msg); if (job.logs.length > 80) job.logs.shift(); } };
  (async () => {
    let inv = null;
    for (const i of listInvestigations()) {
      if (i.start === address && Date.now() - i.createdAt < 30 * 60 * 1000) { inv = JSON.parse(readFileSync(invPath(i.id), 'utf8')); emit({ type: 'log', msg: 'Traque de moins de 30 min reprise' }); break; }
    }
    if (!inv) {
      emit({ type: 'log', msg: 'Traque du dev : montants exacts sur 72 h, tous les hot wallets de son exchange' });
      inv = await trace(address, new Rpc({ ...cfg, cache }), { ...PRESETS.normal, history: fundingHistory() }, emit);
      inv.id = `${inv.start.slice(0, 8)}-${Date.now().toString(36)}`;
      inv.preset = 'normal';
      writeFileSync(invPath(inv.id), JSON.stringify(inv));
      watchInv(inv);
    }
    job.start = inv.start;
    const d = await exchangeDossier(inv, new Rpc({ ...cfg, cache }), emit, { history: fundingHistory() });
    writeFileSync(exdPath(d.start), JSON.stringify(d));
    exwatch.enrich(d);
    emit({ type: 'log', msg: `Dossier prêt : ${d.verdict?.title || 'terminé'}` });
  })()
    .catch((err) => { job.error = err.message || String(err); })
    .finally(() => { job.done = true; setTimeout(() => exJobs.delete(id), 30 * 60 * 1000); });
  return id;
}
const watchInv = (inv, backfill = false) => { try { exwatch.addFromInvestigation(inv, undefined, { backfill }); } catch (e) { console.log('Surveillance :', e.message); } };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const invPath = (id) => path.join(INV, `${id}.json`);
const validId = (id) => /^[A-Za-z0-9-]{10,80}$/.test(id);

function listInvestigations() {
  return readdirSync(INV).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const r = JSON.parse(readFileSync(path.join(INV, f), 'utf8'));
      return { id: r.id, start: r.start, createdAt: r.createdAt, preset: r.preset, terminal: r.terminal, mother: r.mother, stats: r.stats, verdict: r.advice?.verdict || null, mode: r.advice?.mode || null, urgent: !!r.advice?.urgent, pattern: r.pattern?.title || null, lastLaunchAt: lastLaunchOf(r), team: teamKeys(r), pnl: r.qualification?.backtest ? (() => { const b = r.qualification.backtest; // recalculé à la mise du user (0,15 SOL), quelle que soit la mise du calcul enregistré
      const at = (avg) => b.trades * ((avg / 100) * BUY_SOL - 0.038);
      const bts = (r.qualification.tokens || []).map((t) => t.bt).filter(Boolean);
      const avgOf = (id) => (bts.length ? bts.reduce((x, t) => x + (t.strategies?.[id]?.pct ?? (id === 's1' ? t.pct : 0)), 0) / bts.length : 0);
      const best = ['s1', 's2', 's3'].map((id) => ({ id, avg: avgOf(id) })).reduce((x, y) => (y.avg > x.avg ? y : x)); return { n: bts.length, sol: at(best.avg), strat: best.id }; })() : null };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

// Ce que tes enquêtes savent déjà : quelle source a financé quel dev, avec quel montant.
function fundingHistory() {
  const out = [];
  for (const f of readdirSync(INV).filter((x) => x.endsWith('.json'))) {
    try {
      const r = JSON.parse(readFileSync(path.join(INV, f), 'utf8'));
      const devs = new Set((r.tokens || []).map((t) => t.creator));
      for (const w of r.wallets || []) if (w.funder && devs.has(w.address)) out.push({ source: w.funder, dev: w.address, sol: w.fundedSol, inv: r.id, start: r.start });
      for (const d of r.census?.devs || []) out.push({ source: r.census.source, dev: d.address, sol: d.amount, inv: r.id, start: r.start });
    } catch { /* enquête illisible : ignorée */ }
  }
  return out;
}

function startJob(address, preset) {
  const id = `${address.slice(0, 8)}-${Date.now().toString(36)}`;
  const job = { id, address, events: [], listeners: new Set(), done: false };
  jobs.set(id, job);
  const emit = (e) => {
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  const rpc = new Rpc({ ...cfg, cache });
  trace(address, rpc, { ...PRESETS[preset], history: fundingHistory() }, emit)
    .then((result) => {
      result.id = id;
      result.preset = preset;
      writeFileSync(invPath(id), JSON.stringify(result));
      watchInv(result);
      emit({ type: 'done', id });
    })
    .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
    .finally(() => {
      job.done = true;
      setTimeout(() => jobs.delete(id), 10 * 60 * 1000);
    });
  return id;
}

// ---------- recherche de ruggers ----------
const SCAN_FILE = path.join(DATA, 'scan-last.json');
let runningScan = null;

// Wallets déjà vus dans les enquêtes enregistrées : un dev qui y figure est signalé par le scanner.
function knownWallets() {
  const known = new Map();
  for (const f of readdirSync(INV).filter((x) => x.endsWith('.json'))) {
    try {
      const r = JSON.parse(readFileSync(path.join(INV, f), 'utf8'));
      const entry = { id: r.id, start: r.start, rugs: r.stats?.rugs || 0 };
      // la source de ses devs (wallet mère, exchange + montant) : un nouveau dev financé par elle dans les plages, c'est lui
      const c = r.census;
      if (c?.source && c.devs?.length >= 2 && c.kind !== 'service' && c.ranges?.length) {
        known.set(c.source, { ...entry, source: true, kind: c.kind, label: c.label || null, ranges: c.ranges });
      }
      // ses devs retirés d'un exchange : le montant exact (±0,0001) est sa signature, même vu une seule fois
      for (const w of r.wallets || []) {
        const ex = w.funderLabel || (r.terminal?.hot && w.funder === r.terminal.address ? 'Exchange sans nom' : null);
        if (!ex || !w.tokens || !w.fundedSol) continue;
        const cur = known.get(w.funder);
        const rg = { min: Math.round((w.fundedSol - 0.0001) * 1e4) / 1e4, max: Math.round((w.fundedSol + 0.0001) * 1e4) / 1e4, n: 1, amount: w.fundedSol };
        if (cur?.source) { if (!cur.ranges.some((x) => rg.min >= x.min && rg.max <= x.max)) cur.ranges.push(rg); }
        else known.set(w.funder, { ...entry, source: true, kind: 'exchange', label: ex, ranges: [rg] });
      }
      if (!entry.rugs) continue;
      for (const w of r.wallets || []) if (!known.has(w.address) || known.get(w.address).rugs < entry.rugs) known.set(w.address, entry);
    } catch { /* enquête illisible : ignorée */ }
  }
  return known;
}

function startScan(options) {
  if (runningScan && jobs.get(runningScan)?.done === false) return runningScan;
  const id = `scan-${Date.now().toString(36)}`;
  const job = { id, events: [], listeners: new Set(), done: false };
  jobs.set(id, job);
  runningScan = id;
  const emit = (e) => {
    if (e.type === 'tokens') job.events = job.events.filter((x) => x.type !== 'tokens'); // on ne garde que la dernière liste
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  scan(new Rpc({ ...cfg, cache }), options, emit, knownWallets())
    .then((result) => {
      writeFileSync(SCAN_FILE, JSON.stringify(result));
      emit({ type: 'done', id });
    })
    .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
    .finally(() => {
      job.done = true;
      setTimeout(() => jobs.delete(id), 10 * 60 * 1000);
    });
  return id;
}

// ---------- chasse aux ruggers (3 dernières heures, N ruggers analysés en entier) ----------
const HUNT_FILE = path.join(DATA, 'hunt-last.json');
let runningHunt = null;
let solPrice = null;
const REAL_FILE = path.join(DATA, 'real-last.json');
const WALLETS_FILE = path.join(DATA, 'wallets.json');
let runningReal = null;
function huntSummary(inv) {
  const bts = (inv.qualification?.tokens || []).map((t) => t.bt).filter(Boolean);
  const avgOf = (id) => (bts.length ? bts.reduce((x, t) => x + (t.strategies?.[id]?.pct ?? (id === 's1' ? t.pct : 0)), 0) / bts.length : 0);
  const best = ['s1', 's2', 's3'].map((id) => ({ id, avg: avgOf(id) })).reduce((x, y) => (y.avg > x.avg ? y : x));
  const last = lastLaunchOf(inv);
  const a = inv.advice || {};
  return {
    id: inv.id, verdict: a.verdict || null, mode: a.mode || null, address: a.address || null, pattern: inv.pattern?.title || null, notDev: !!a.notDev,
    reason: a.inactive ? a.inactiveReason : a.reason || null, tip: a.tip || null, urgent: !!a.urgent,
    // pour regrouper les résultats d'une même équipe dans la chasse : ses sources partagées, son tracker, ses devs connus
    teamKeys: [...teamKeys(inv).map((k) => k.key), ...(a.address ? [`trk:${a.address}`] : [])],
    members: [...new Set([inv.start, ...[...(inv.tokens || []), ...(inv.after || []), ...(inv.siblingTokens || [])].map((t) => t.creator), ...(inv.flow?.path || []).map((p) => p.address)].filter(Boolean))].slice(0, 150),
    // dev financé par un exchange (Binance, Coinbase…) : le schéma prioritaire, classé en tête à niveau égal
    exchange: inv.tracker?.kind === 'cex' || a.evidence === 'cex' || (inv.fingerprints || []).some((f) => f.kind === 'exchange'),
    exchangeName: (inv.fingerprints || []).find((f) => f.kind === 'exchange')?.name || null,
    n: bts.length, tp: bts.filter((t) => t.outcome === 'tp').length, bestStrat: best.id, avgPct: best.avg,
    bestPnl: bts.length * ((best.avg / 100) * BUY_SOL - 0.038), lastLaunchAt: last, inactive: !!last && Date.now() / 1000 - last > 86400,
  };
}
function startHunt(options) {
  if (runningHunt && jobs.get(runningHunt)?.done === false) return runningHunt;
  const id = `hunt-${Date.now().toString(36)}`;
  const job = { id, events: [], listeners: new Set(), done: false };
  jobs.set(id, job);
  runningHunt = id;
  const emit = (e) => {
    if (e.type === 'hunt') job.events = job.events.filter((x) => x.type !== 'hunt');
    if (e.type === 'sub') job.events = job.events.filter((x) => x.type !== 'sub');
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  const rpc = new Rpc({ ...cfg, cache });
  const deps = {
    recent: (address) => {
      for (const i of listInvestigations()) {
        if (i.start === address && Date.now() - i.createdAt < 6 * 3600 * 1000) return JSON.parse(readFileSync(invPath(i.id), 'utf8'));
      }
      return null;
    },
    traceDev: async (address, sub) => {
      const result = await trace(address, new Rpc({ ...cfg, cache }), { ...PRESETS.normal, history: fundingHistory() }, sub);
      result.id = `${address.slice(0, 8)}-${Date.now().toString(36)}`;
      result.preset = 'normal';
      writeFileSync(invPath(result.id), JSON.stringify(result));
      watchInv(result);
      return result;
    },
    qualified: (inv) => inv.qualification?.rule === QUAL_RULE,
    qualifyInv: async (inv, sub) => {
      const q = await qualify(inv, cache, sub, { rpc: new Rpc({ ...cfg, cache }) });
      if (existsSync(invPath(inv.id))) writeFileSync(invPath(inv.id), JSON.stringify({ ...JSON.parse(readFileSync(invPath(inv.id), 'utf8')), qualification: q }));
      return q;
    },
    summarize: huntSummary,
    shouldStop: () => !!job.stop,
    save: (snap) => writeFileSync(HUNT_FILE, JSON.stringify(snap)),
  };
  hunt(rpc, options, emit, deps)
    .then((result) => { writeFileSync(HUNT_FILE, JSON.stringify(result)); emit({ type: 'done', id }); })
    .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
    .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 30 * 60 * 1000); });
  return id;
}

// ---------- chasse aux wallets (bundle et premiers acheteurs des coins rug) ----------
const WHUNT_FILE = path.join(DATA, 'wallet-hunt-last.json');
let runningWalletHunt = null;
async function solUsdNow() {
  if (!solPrice || Date.now() - solPrice.at > 5 * 60 * 1000) {
    try {
      const a = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(10000) })).json();
      const best = a.filter((x) => x.baseToken?.address === 'So11111111111111111111111111111111111111112' && /USD/.test(x.quoteToken?.symbol || '')).sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0];
      if (best) solPrice = { usd: Number(best.priceUsd), at: Date.now() };
    } catch { /* on garde l'ancien prix */ }
  }
  return solPrice?.usd ?? null;
}
function readWallets() { return existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) : {}; }
function saveWallet(c) {
  const all = readWallets();
  all[c.wallet] = { ...c, createdAt: Date.now() };
  const keep = Object.values(all).sort((x, y) => y.createdAt - x.createdAt).slice(0, 60);
  writeFileSync(WALLETS_FILE, JSON.stringify(Object.fromEntries(keep.map((x) => [x.wallet, x]))));
}
function startWalletHunt(options) {
  if (runningWalletHunt && jobs.get(runningWalletHunt)?.done === false) return runningWalletHunt;
  const id = `whunt-${Date.now().toString(36)}`;
  const job = { id, events: [], listeners: new Set(), done: false };
  jobs.set(id, job);
  runningWalletHunt = id;
  const emit = (e) => {
    if (e.type === 'hunt') job.events = job.events.filter((x) => x.type !== 'hunt');
    if (e.type === 'sub') job.events = job.events.filter((x) => x.type !== 'sub');
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  const deps = {
    shouldStop: () => !!job.stop,
    save: (snap) => writeFileSync(WHUNT_FILE, JSON.stringify(snap)),
    saveWallet,
    recentWallet: (address) => { const c = readWallets()[address]; return c && c.mode === 'tracker-v2' && Date.now() - c.createdAt < 6 * 3600 * 1000 ? c : null; },
  };
  solUsdNow().then((usd) => walletHunt(new Rpc({ ...cfg, cache }), options, emit, { ...deps, solUsd: usd }))
    .then((result) => { writeFileSync(WHUNT_FILE, JSON.stringify(result)); emit({ type: 'done', id }); })
    .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
    .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 30 * 60 * 1000); });
  return id;
}

// analyse complète d'un dev : traque (ou enquête de moins de 6 h réutilisée) + rentabilité, puis le résumé
async function analyseDev(address, sub) {
  let inv = null;
  for (const i of listInvestigations()) {
    // reprise d'une enquête récente seulement (30 min : le dev bouge vite), et faite avec le suivi d'argent actuel
    if (i.start === address && Date.now() - i.createdAt < 30 * 60 * 1000) {
      const old = JSON.parse(readFileSync(invPath(i.id), 'utf8'));
      if (old.flow && Array.isArray(old.flow.creates)) { inv = old; break; }
    }
  }
  if (!inv) {
    inv = await trace(address, new Rpc({ ...cfg, cache }), { ...PRESETS.normal, history: fundingHistory() }, sub);
    inv.id = `${address.slice(0, 8)}-${Date.now().toString(36)}`;
    inv.preset = 'normal';
    writeFileSync(invPath(inv.id), JSON.stringify(inv));
    watchInv(inv);
  }
  if (inv.qualification?.rule !== QUAL_RULE && !inv.advice?.notDev) {
    inv.qualification = await qualify(inv, cache, sub, { rpc: new Rpc({ ...cfg, cache }) });
    if (existsSync(invPath(inv.id))) writeFileSync(invPath(inv.id), JSON.stringify({ ...JSON.parse(readFileSync(invPath(inv.id), 'utf8')), qualification: inv.qualification }));
  }
  return huntSummary(inv);
}

// ---------- chasse aux ruggers par filtres (critères du user, sur 3 h) ----------
const FHUNT_FILE = path.join(DATA, 'filter-hunt-last.json');
let runningFilterHunt = null;
function startFilterHunt(filters) {
  if (runningFilterHunt && jobs.get(runningFilterHunt)?.done === false) return runningFilterHunt;
  const id = `fhunt-${Date.now().toString(36)}`;
  const job = { id, events: [], listeners: new Set(), done: false };
  jobs.set(id, job);
  runningFilterHunt = id;
  const emit = (e) => {
    if (e.type === 'hunt') job.events = job.events.filter((x) => x.type !== 'hunt');
    if (e.type === 'sub') job.events = job.events.filter((x) => x.type !== 'sub');
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  solUsdNow()
    .then((usd) => filterHunt(new Rpc({ ...cfg, cache }), filters, emit, { solUsd: usd, createsOf, analyse: analyseDev, shouldStop: () => !!job.stop, save: (snap) => writeFileSync(FHUNT_FILE, JSON.stringify(snap)) }))
    .then((result) => { writeFileSync(FHUNT_FILE, JSON.stringify(result)); emit({ type: 'done', id }); })
    .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
    .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 30 * 60 * 1000); });
  return id;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/config' && req.method === 'GET') {
      return json(res, 200, { provider: cfg.provider, rps: cfg.rps, presets: PRESETS });
    }
    if (p === '/api/exsnipe' && req.method === 'POST') {
      const b = await readBody(req);
      const address = String(b.address || '').trim();
      if (!isAddress(address)) return json(res, 400, { error: 'Adresse Solana invalide : colle le wallet du dev ou le CA du token.' });
      if (cfg.provider !== 'helius') return json(res, 400, { error: 'Le dossier exchange a besoin d’une clé Helius.' });
      return json(res, 200, { id: startExSnipe(address) });
    }
    if (p === '/api/exsnipe' && req.method === 'GET') return json(res, 200, { dossiers: listDossiers(), watch: exwatch.list(), jobs: [...exJobs.values()].filter((j) => !j.done).map((j) => ({ id: j.id, address: j.address })) });
    if (p.startsWith('/api/exsnipe/job/') && req.method === 'GET') {
      const j = exJobs.get(p.slice('/api/exsnipe/job/'.length));
      if (!j) return json(res, 404, { error: 'Analyse introuvable (serveur relancé ?)' });
      return json(res, 200, { id: j.id, address: j.address, start: j.start, done: j.done, error: j.error, logs: j.logs.slice(-12), startedAt: j.startedAt });
    }
    if (p.startsWith('/api/exsnipe/d/') && req.method === 'GET') {
      const start = p.slice('/api/exsnipe/d/'.length);
      if (!isAddress(start) || !existsSync(exdPath(start))) return json(res, 404, { error: 'Dossier introuvable' });
      const d = JSON.parse(readFileSync(exdPath(start), 'utf8'));
      return json(res, 200, { ...d, watch: exwatch.state.watches.find((w) => w.id === start) || null });
    }
    if (p === '/api/exsnipe/remove' && req.method === 'POST') {
      const b = await readBody(req);
      const start = String(b.start || '');
      if (!isAddress(start)) return json(res, 400, { error: 'Adresse invalide' });
      exwatch.remove(start);
      if (existsSync(exdPath(start))) unlinkSync(exdPath(start));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/exwatch' && req.method === 'GET') return json(res, 200, exwatch.list());
    if (p === '/api/exwatch/tick' && req.method === 'POST') return json(res, 200, await exwatch.tick());
    if (p === '/api/exwatch/remove' && req.method === 'POST') { const b = await readBody(req); exwatch.remove(String(b.id || '')); return json(res, 200, exwatch.list()); }
    if (p === '/api/labels' && req.method === 'GET') {
      return json(res, 200, Object.entries(LABELS).map(([address, l]) => ({ address, ...l })));
    }
    if (p === '/api/labels' && req.method === 'POST') {
      const b = await readBody(req);
      const address = String(b.address || '').trim();
      if (!isAddress(address)) return json(res, 400, { error: 'Adresse Solana invalide.' });
      const name = String(b.name || '').trim().slice(0, 40);
      const type = ['exchange', 'service', 'infra'].includes(b.type) ? b.type : 'exchange';
      setLocalLabel(address, name ? { name, type } : null);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/trace' && req.method === 'POST') {
      const body = await readBody(req);
      const address = String(body.address || '').trim();
      const preset = PRESETS[body.preset] ? body.preset : 'normal';
      if (!isAddress(address)) return json(res, 400, { error: 'Adresse Solana invalide.' });
      return json(res, 200, { id: startJob(address, preset) });
    }
    if (p === '/api/scan' && req.method === 'POST') {
      const b = await readBody(req);
      const num = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : def);
      return json(res, 200, {
        id: startScan({
          minVolume: num(b.minVolume, 0, 1e9, SCAN_DEFAULTS.minVolume),
          maxAgeMin: num(b.maxAgeMin, 1, 60, SCAN_DEFAULTS.maxAgeMin),
          deep: num(b.deep, 0, 20, SCAN_DEFAULTS.deep),
          newPairs: b.newPairs !== false,
          singleCreateOnly: b.singleCreateOnly !== false,
          finalStretch: b.finalStretch !== false,
        }),
      });
    }
    if (p === '/api/hunt' && req.method === 'POST') {
      const b = await readBody(req);
      const num = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : def);
      return json(res, 200, { id: startHunt({ target: num(b.target, 1, 20, HUNT_DEFAULTS.target), hours: num(b.hours, 1, 12, HUNT_DEFAULTS.hours), minVolume: num(b.minVolume, 0, 1e9, HUNT_DEFAULTS.minVolume) }) });
    }
    // bilan réel : les vrais trades du wallet du user, comparés aux prévisions des enquêtes
    if (p === '/api/real' && req.method === 'POST') {
      const b = await readBody(req);
      const wallet = String(b.wallet || '').trim();
      if (!isAddress(wallet)) return json(res, 400, { error: 'Adresse de wallet invalide.' });
      const days = Math.max(1, Math.min(30, Math.round(Number(b.days) || 7)));
      if (runningReal && jobs.get(runningReal)?.done === false) return json(res, 200, { id: runningReal });
      const id = `real-${Date.now().toString(36)}`;
      const job = { id, events: [], listeners: new Set(), done: false };
      jobs.set(id, job);
      runningReal = id;
      const emit = (e) => { job.events.push(e); for (const l of job.listeners) l(e); };
      const invs = listInvestigations().map((i) => { try { return JSON.parse(readFileSync(invPath(i.id), 'utf8')); } catch { return null; } }).filter(Boolean);
      realReport(new Rpc({ ...cfg, cache }), wallet, invs, emit, { days })
        .then((r) => { writeFileSync(REAL_FILE, JSON.stringify(r)); emit({ type: 'done', id }); })
        .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
        .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 10 * 60 * 1000); });
      return json(res, 200, { id });
    }
    if (p === '/api/real/last' && req.method === 'GET') {
      return json(res, 200, { running: runningReal && jobs.get(runningReal)?.done === false ? runningReal : null, result: existsSync(REAL_FILE) ? JSON.parse(readFileSync(REAL_FILE, 'utf8')) : null });
    }
    // Wallet tracker : un wallet collé par le user, est-il bon à copier, et serait-il rentable ?
    if (p === '/api/wallet' && req.method === 'POST') {
      const b = await readBody(req);
      const wallet = String(b.wallet || '').trim();
      if (!isAddress(wallet)) return json(res, 400, { error: 'Adresse de wallet invalide.' });
      const id = `wallet-${wallet.slice(0, 8)}`;
      if (jobs.get(id)?.done === false) return json(res, 200, { id });
      const job = { id, events: [], listeners: new Set(), done: false };
      jobs.set(id, job);
      const emit = (e) => { job.events.push(e); for (const l of job.listeners) l(e); };
      // les devs de toutes tes enquêtes : « achète-t-il les tokens de tes ruggers ? »
      const network = new Set();
      for (const i of listInvestigations()) {
        try {
          const r = JSON.parse(readFileSync(invPath(i.id), 'utf8'));
          [r.start, ...(r.census?.devs || []).map((d) => d.address), ...(r.census?.siblings || []).map((s) => s.address), ...[...(r.tokens || []), ...(r.siblingTokens || [])].map((t) => t.creator)].filter(Boolean).forEach((a) => network.add(a));
        } catch { /* enquête illisible */ }
      }
      solUsdNow().then((usd) => analyseCopyWallet(new Rpc({ ...cfg, cache }), wallet, { solUsd: usd, emit }))
        .then((c) => {
          const all = existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) : {};
          all[wallet] = { ...c, createdAt: Date.now() };
          const keep = Object.values(all).sort((x, y) => y.createdAt - x.createdAt).slice(0, 30);
          writeFileSync(WALLETS_FILE, JSON.stringify(Object.fromEntries(keep.map((x) => [x.wallet, x]))));
          emit({ type: 'done', id });
        })
        .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
        .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 10 * 60 * 1000); });
      return json(res, 200, { id });
    }
    if (p === '/api/filterhunt' && req.method === 'POST') return json(res, 200, { id: startFilterHunt(await readBody(req)) });
    if (p === '/api/filterhunt/stop' && req.method === 'POST') {
      const job = runningFilterHunt && jobs.get(runningFilterHunt);
      if (job && !job.done) job.stop = true;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/filterhunt/last' && req.method === 'GET') {
      const running = runningFilterHunt && jobs.get(runningFilterHunt)?.done === false ? runningFilterHunt : null;
      return json(res, 200, { running, result: existsSync(FHUNT_FILE) ? JSON.parse(readFileSync(FHUNT_FILE, 'utf8')) : null });
    }
    if (p === '/api/wallethunt' && req.method === 'POST') {
      const b = await readBody(req);
      const num = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : def);
      return json(res, 200, { id: startWalletHunt({ target: num(b.target, 1, 20, 3), hours: num(b.hours, 1, 12, 3), minVolume: num(b.minVolume, 0, 1e9, 15000) }) });
    }
    if (p === '/api/wallethunt/stop' && req.method === 'POST') {
      const job = runningWalletHunt && jobs.get(runningWalletHunt);
      if (job && !job.done) job.stop = true;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/wallethunt/last' && req.method === 'GET') {
      const running = runningWalletHunt && jobs.get(runningWalletHunt)?.done === false ? runningWalletHunt : null;
      return json(res, 200, { running, result: existsSync(WHUNT_FILE) ? JSON.parse(readFileSync(WHUNT_FILE, 'utf8')) : null });
    }
    if (p === '/api/wallet/list' && req.method === 'GET') {
      const all = existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) : {};
      return json(res, 200, Object.values(all).sort((x, y) => y.createdAt - x.createdAt));
    }
    const mw = /^\/api\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(p);
    if (mw && req.method === 'DELETE') {
      const all = existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) : {};
      delete all[mw[1]];
      writeFileSync(WALLETS_FILE, JSON.stringify(all));
      return json(res, 200, { ok: true });
    }
    // prix du SOL en dollars (pour le filtre Max MC du bot, en $)
    if (p === '/api/solprice' && req.method === 'GET') return json(res, 200, { usd: await solUsdNow() });
    if (p === '/api/hunt/stop' && req.method === 'POST') {
      const job = runningHunt && jobs.get(runningHunt);
      if (job && !job.done) job.stop = true;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/hunt/last' && req.method === 'GET') {
      const running = runningHunt && jobs.get(runningHunt)?.done === false ? runningHunt : null;
      return json(res, 200, { running, result: existsSync(HUNT_FILE) ? JSON.parse(readFileSync(HUNT_FILE, 'utf8')) : null });
    }
    if (p === '/api/scan/last' && req.method === 'GET') {
      if (!existsSync(SCAN_FILE)) return json(res, 200, { running: runningScan && jobs.get(runningScan)?.done === false ? runningScan : null, result: null });
      return json(res, 200, { running: runningScan && jobs.get(runningScan)?.done === false ? runningScan : null, result: JSON.parse(readFileSync(SCAN_FILE, 'utf8')) });
    }
    let m;
    if ((m = /^\/api\/trace\/([^/]+)\/events$/.exec(p)) && req.method === 'GET') {
      const job = jobs.get(m[1]);
      if (!job) return json(res, 404, { error: 'Traçage introuvable.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      job.events.forEach(send);
      if (job.done) return res.end();
      const listener = (e) => { send(e); if (e.type === 'done' || e.type === 'error') res.end(); };
      job.listeners.add(listener);
      req.on('close', () => job.listeners.delete(listener));
      return;
    }
    if (p === '/api/investigations' && req.method === 'GET') return json(res, 200, listInvestigations());
    if ((m = /^\/api\/investigations\/([^/]+)$/.exec(p))) {
      if (!validId(m[1]) || !existsSync(invPath(m[1]))) return json(res, 404, { error: 'Enquête introuvable.' });
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return createReadStream(invPath(m[1])).pipe(res);
      }
      if (req.method === 'DELETE') { unlinkSync(invPath(m[1])); return json(res, 200, { ok: true }); }
    }
    // qualification « méthode 1 » : lit les bougies des tokens de l'enquête (5 par minute, mises en cache)
    if ((m = /^\/api\/investigations\/([^/]+)\/qualify$/.exec(p)) && req.method === 'POST') {
      const invId = m[1];
      if (!validId(invId) || !existsSync(invPath(invId))) return json(res, 404, { error: 'Enquête introuvable.' });
      const id = `qual-${invId}`;
      if (jobs.get(id) && !jobs.get(id).done) return json(res, 200, { id });
      const job = { id, events: [], listeners: new Set(), done: false };
      jobs.set(id, job);
      const emit = (e) => { job.events.push(e); for (const l of job.listeners) l(e); };
      const inv = JSON.parse(readFileSync(invPath(invId), 'utf8'));
      qualify(inv, cache, emit, { rpc: new Rpc({ ...cfg, cache }) })
        .then((q) => {
          if (existsSync(invPath(invId))) writeFileSync(invPath(invId), JSON.stringify({ ...JSON.parse(readFileSync(invPath(invId), 'utf8')), qualification: q }));
          emit({ type: 'done', id: invId });
        })
        .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
        .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 60 * 1000); });
      return json(res, 200, { id });
    }
    // snipers à copier : ceux qui entrent juste après le dev sur ses tokens, et la copie de leurs achats récents
    if ((m = /^\/api\/investigations\/([^/]+)\/snipers$/.exec(p)) && req.method === 'POST') {
      const invId = m[1];
      if (!validId(invId) || !existsSync(invPath(invId))) return json(res, 404, { error: 'Enquête introuvable.' });
      const id = `snip-${invId}`;
      if (jobs.get(id) && !jobs.get(id).done) return json(res, 200, { id });
      const job = { id, events: [], listeners: new Set(), done: false };
      jobs.set(id, job);
      const emit = (e) => { job.events.push(e); for (const l of job.listeners) l(e); };
      const inv = JSON.parse(readFileSync(invPath(invId), 'utf8'));
      findSnipers(inv, new Rpc({ ...cfg, cache }), emit)
        .then((sn) => {
          if (existsSync(invPath(invId))) writeFileSync(invPath(invId), JSON.stringify({ ...JSON.parse(readFileSync(invPath(invId), 'utf8')), snipers: sn }));
          emit({ type: 'done', id: invId });
        })
        .catch((err) => emit({ type: 'error', msg: err.message || String(err) }))
        .finally(() => { job.done = true; setTimeout(() => jobs.delete(id), 60 * 1000); });
      return json(res, 200, { id });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Route inconnue.' });

    // fichiers statiques
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch (err) {
    json(res, 500, { error: err.message || 'Erreur serveur' });
  }
});

// au démarrage : les ruggers exchange des enquêtes des 3 derniers jours, puis une lecture toutes les 3 min
{
  const since = Date.now() - 72 * 3600 * 1000;
  const seen = new Set(exwatch.state.watches.map((w) => w.id));
  for (const i of listInvestigations()) {
    if (i.createdAt < since || seen.has(i.start)) continue;
    seen.add(i.start);
    try { watchInv(JSON.parse(readFileSync(invPath(i.id), 'utf8')), true); } catch { /* enquête illisible */ }
  }
  if (cfg.provider === 'helius') {
    setTimeout(() => exwatch.tick().catch(() => {}), 15000);
    setInterval(() => exwatch.tick().catch(() => {}), EXWATCH.everySec * 1000);
  }
}

server.listen(PORT, '127.0.0.1', () => {
  const who = cfg.provider === 'helius' ? 'Helius' : cfg.provider === 'custom' ? 'RPC personnalisé' : 'RPC public (lent : ajoute une clé Helius dans .env)';
  console.log(`RugTrace : http://localhost:${PORT}  ·  ${who}`);
});
