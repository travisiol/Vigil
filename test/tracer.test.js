// Scénario fabriqué, sans réseau Solana. Lancer : node --test
//
//   Binance ──10──> Mere ──> Dev1, Dev2, Dev3            (wallet mère)
//   Binance ──4───> Lie1                                  (financé à part, aucun lien de financement)
//   Dev1, Dev2, Lie1 ──> Depot ──> Binance                (même adresse de dépôt : même compte)
//   Binance ──2,49──> Neuf1   après le dépôt de 2,5 de Dev1
//   Binance ──3,99──> Neuf2   après 2,5 + 0,5 + 1 = 4 déposés
//   Binance ──10────> Habit1  même montant que le financement de Mere
import test from 'node:test';
import assert from 'node:assert/strict';
import { trace, PRESETS } from '../src/tracer.js';

const BINANCE = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const [M, D1, D2, D3, L1, DEP, N1, N2, H1, X1, X2] = ['Mere', 'Dev1', 'Dev2', 'Dev3', 'Lie1', 'Depot', 'Neuf1', 'Neuf2', 'Habit1', 'Autre1', 'Autre2'];
const [T1, T2, T3, T4, T5, T6] = ['MintUn', 'MintDeux', 'MintTrois', 'MintQuatre', 'MintCinq', 'MintSix'];
const [C1, R1, R2, X3] = ['Createur1', 'Relais1', 'Relais2', 'Autre3'];
const SOL = 1e9;

const send = (sig, time, from, to, sol) => ({
  sig, time, failed: false, feePayer: from, fee: 5000, signers: [from],
  solDelta: { [from]: -sol * SOL - 5000, [to]: sol * SOL }, tokenDelta: [],
  transfers: [{ from, to, lamports: sol * SOL, top: true }], pump: false, create: null,
});
const pump = (sig, time, who, mint, tokens, sol, create = null) => ({
  sig, time, failed: false, feePayer: who, fee: 5000, signers: [who],
  solDelta: { [who]: sol * SOL - 5000 }, tokenDelta: [{ owner: who, mint, delta: tokens, post: Math.max(0, tokens) }],
  transfers: [], pump: true, create,
});
const mint = (m, name) => ({ mint: m, name, symbol: name.toUpperCase(), uri: `https://x/${name}` });

const txs = [
  send('s1', 100, BINANCE, M, 10),
  send('s20', 150, BINANCE, L1, 4),
  pump('s21', 160, L1, T3, 1000, -1, mint(T3, 'trois')),
  pump('s22', 180, L1, T3, -1000, 3),
  send('s2', 200, M, D1, 2),
  pump('s5', 210, D1, T1, 1000, -1, mint(T1, 'un')),
  pump('s6', 260, D1, T1, -1000, 2),
  send('s7', 270, D1, DEP, 2.5),
  send('s3', 300, M, D2, 1.5),
  pump('s8', 310, D2, T2, 500, -0.5, mint(T2, 'deux')),
  send('s9', 320, D2, DEP, 0.5),
  send('s11', 325, L1, DEP, 1),
  send('s10', 330, DEP, BINANCE, 4),
  send('s4', 400, M, D3, 3),
  send('s12', 400, BINANCE, N1, 2.49),
  send('s14', 450, BINANCE, X1, 7),
  send('s13', 500, BINANCE, N2, 3.99),
  pump('s30', 520, N2, T4, 1000, -1, mint(T4, 'quatre')),
  // empreinte : Binance a financé Mere avec 10 SOL, on suit ses autres envois de 10 SOL (±0,0001)
  send('s16', 700, BINANCE, H1, 10), // reçu, rien créé, encore plein : en attente
  send('s23', 705, BINANCE, C1, 9.99995),
  pump('s24', 715, C1, T6, 1000, -1, mint(T6, 'six')), // crée directement
  send('s17', 710, BINANCE, R1, 10.00005),
  send('s18', 720, R1, R2, 9.9), // relais : l'argent repart vers un autre wallet
  pump('s19', 730, R2, T5, 1000, -1, mint(T5, 'cinq')), // qui crée
  send('s25', 740, BINANCE, X3, 10.0005), // hors tolérance : la plage est de ±0,0001 SOL
  send('s15', 100000, BINANCE, X2, 2.5), // bon montant, mais bien après la fenêtre
];
const byId = Object.fromEntries(txs.map((t) => [t.sig, t]));
// historique de chaque adresse, du plus récent au plus ancien
const history = {};
for (const t of [...txs].sort((a, b) => b.time - a.time)) {
  for (const a of new Set([...t.signers, ...t.transfers.flatMap((x) => [x.from, x.to])])) (history[a] ||= []).push(t.sig);
}
const rpc = {
  calls: 0, cacheHits: 0,
  async sigsPage(address) { this.calls++; return (history[address] || []).map((s) => ({ signature: s, blockTime: byId[s].time, err: null })); },
  async tx(sig) { this.calls++; return byId[sig]; },
  async balances(list) { return Object.fromEntries(list.map((a) => [a, a === D3 ? 3 * SOL : a === H1 ? 10 * SOL : 0.001 * SOL])); },
};

async function run(start) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] }); // marché inconnu
  try { return await trace(start, rpc, { ...PRESETS.normal, now: 800 }); } finally { globalThis.fetch = realFetch; }
}
const r = await run(D1);
if (process.env.DEBUG_T) console.log(JSON.stringify({ census: r.census, pattern: r.pattern.type }, null, 1));
const w = Object.fromEntries(r.wallets.map((x) => [x.address, x]));

test('remonte jusqu\'à l\'exchange et trouve le wallet mère', () => {
  assert.deepEqual(r.terminal, { type: 'exchange', address: BINANCE, label: 'Binance' });
  assert.deepEqual(r.chain, [M, D1]);
  assert.equal(r.root, M);
  assert.equal(r.mother, M);
  assert.equal(w[M].children, 3);
  assert.equal(w[D2].funder, M);
  assert.equal(w[D2].fundedSol, 1.5);
});

test('classe les tokens et les candidats', () => {
  const t = Object.fromEntries(r.tokens.map((x) => [x.mint, x]));
  assert.equal(t[T1].status, 'rug');
  assert.equal(t[T1].soldPct, 1);
  assert.ok(Math.abs(t[T1].pnlSol - 1) < 0.001);
  assert.equal(t[T1].holdSeconds, 50);
  assert.equal(t[T2].status, 'holding');
  assert.equal(w[D3].candidate, true, 'Dev3 est financé, a du SOL et aucun token');
  assert.equal(w[D1].candidate, false);
  assert.equal(r.stats.candidates, 1);
});

test('rebondit sur l\'adresse de dépôt : Lie1 rejoint le cluster', () => {
  assert.deepEqual(r.wallets.map((x) => x.address).sort(), [D1, D2, D3, L1, M].sort());
  assert.deepEqual(w[L1].link, { type: 'deposit', via: DEP, exchange: 'Binance' });
  assert.equal(w[L1].funder, BINANCE);
  assert.equal(w[L1].funderLabel, 'Binance');
  assert.equal(w[L1].rugs, 1, 'le token de Lie1 est compté');
  assert.equal(r.stats.rugs, 2);
  assert.equal(r.stats.linked, 1);

  assert.equal(r.cashouts.length, 1, 'l\'adresse de dépôt n\'est pas un wallet du dev');
  assert.equal(r.cashouts[0].address, DEP);
  assert.equal(r.cashouts[0].depositOf, 'Binance');
  assert.deepEqual(r.cashouts[0].from.sort(), [D1, D2, L1].sort());
  assert.equal(r.cashouts[0].sol, 4);
  assert.equal(r.stats.depositSol, 4);
});

test('rapproche les dépôts des retraits de l\'exchange', () => {
  const lead = Object.fromEntries(r.leads.filter((x) => x.type === 'same').map((x) => [x.address, x]));
  assert.deepEqual(Object.keys(lead).sort(), [N1, N2].sort(), 'ni le retrait de 7 SOL, ni celui hors fenêtre');

  assert.equal(lead[N1].type, 'same');
  assert.equal(lead[N1].sol, 2.49);
  assert.equal(lead[N1].depositSol, 2.5);
  assert.deepEqual(lead[N1].depositFrom, [D1]);
  assert.equal(lead[N1].delaySeconds, 130);
  assert.equal(lead[N1].fresh, true);
  assert.equal(lead[N1].tokens, 0);

  assert.equal(lead[N2].type, 'same', 'retrait de la somme des trois dépôts');
  assert.equal(lead[N2].depositSol, 4);
  assert.equal(lead[N2].depositParts, 3);
  assert.deepEqual(lead[N2].depositFrom.sort(), [D1, D2, L1].sort());
  assert.equal(lead[N2].tokens, 1, 'Neuf2 a déjà lancé un token');

  assert.ok(lead[N2].score > lead[N1].score);

  assert.equal(r.exchangeScan.length, 1);
  assert.equal(r.exchangeScan[0].exchange, 'Binance');
  assert.equal(r.exchangeScan[0].status, 'ok');
});

test('empreinte : filtre les envois au montant exact et les suit jusqu\'au créateur', () => {
  const fp = r.fingerprints.find((f) => f.sol === 10);
  assert.ok(fp, 'Binance a financé Mere avec 10 SOL');
  assert.equal(fp.name, 'Binance');
  assert.equal(fp.known, 1, 'l\'envoi vers Mere est déjà connu');
  assert.equal(fp.sends, 3, '10,0005 SOL est hors tolérance, 7 SOL aussi');
  assert.equal(fp.verified, 3);
  assert.equal(fp.creators, 2);
  assert.equal(fp.waiting, 1);
  assert.equal(fp.verdict, 'reliable');
  assert.equal(fp.status, 'ok');

  const lead = Object.fromEntries(r.leads.filter((x) => x.type === 'fingerprint').map((x) => [x.address, x]));
  assert.deepEqual(Object.keys(lead).sort(), [C1, H1, R1].sort());
  assert.equal(lead[C1].status, 'created');
  assert.equal(lead[C1].hops, 0);
  assert.equal(lead[C1].createDelay, 10);
  assert.equal(lead[R1].status, 'created', 'suivi à travers un wallet relais');
  assert.deepEqual(lead[R1].path, [R1, R2]);
  assert.equal(lead[R1].end, R2);
  assert.equal(lead[H1].status, 'waiting', 'a reçu 10 SOL, n\'a rien créé : prochain candidat');
  assert.equal(lead[H1].balanceSol, 10);
  assert.equal(r.leads.find((x) => x.type === 'fingerprint').address, H1, 'le wallet en attente passe devant ceux qui ont déjà créé');

  const small = r.fingerprints.find((f) => f.sol === 4);
  assert.equal(small.verdict, 'insufficient', 'aucun autre envoi de 4 SOL : pas de quoi juger');
});

test('déduit le schéma wallet mère', () => {
  assert.equal(r.pattern.type, 'mother');
  assert.equal(r.pattern.confidence, 'medium');
  assert.ok(r.pattern.reasons.some((x) => x.includes('a financé 3 wallets')));
  assert.ok(r.pattern.reasons.some((x) => x.includes('varient')), 'les montants ne sont pas identiques');
  assert.ok(r.pattern.watch.length > 0);
});

test('réglage tracker : on suit la source et sa plage, pas le wallet enfant', () => {
  assert.equal(r.tracker.verdict, 'track');
  assert.equal(r.tracker.kind, 'cex');
  assert.equal(r.tracker.address, BINANCE);
  assert.equal(r.tracker.minSol, 9.9999);
  assert.equal(r.tracker.maxSol, 10.0001);
  assert.deepEqual(r.tracker.options, ['keepAddress', 'freshWalletOnly', 'removeIfNoLaunch']);
  assert.deepEqual(r.siblingTokens.map((t) => t.mint).sort(), [T5, T6].sort(), 'tokens des wallets frères, pour la qualification');
});

test('qualification : entrée à 75 % de la première bougie, +100 % ou stop au plancher', async () => {
  const { qualifyToken, summarizeSample } = await import('../src/qualify.js');
  const P0 = 30 / 1.073e9;
  const win = qualifyToken([[0, P0, 5e-8, P0, 4e-8], [60, 4e-8, 1e-7, 4e-8, 9e-8], [120, 9e-8, 9e-8, P0, P0]]);
  assert.ok(Math.abs(win.entryMcSol - 30) < 0.01, 'entrée = 75 % de la clôture (40 SOL de MC) = 30 SOL');
  assert.ok(Math.abs(win.gainPct - 233.3) < 0.5);
  assert.equal(win.hit, true);
  assert.ok(Math.abs(win.naturalSlPct + 6.8) < 0.1, 'stop naturel : retour au plancher de 27,96 SOL');
  assert.equal(win.minutesToAth, 1);
  const loss = qualifyToken([[0, P0, 6e-8, P0, 6e-8], [60, 6e-8, 7e-8, P0, P0]]);
  assert.equal(loss.hit, false);
  assert.ok(Math.abs(loss.naturalSlPct + 37.9) < 0.1);
  assert.equal(qualifyToken([]), null);

  const thin = summarizeSample([{ createdAt: 0, ...win }, { createdAt: 3600, ...loss }]);
  assert.equal(thin.verdict, 'thin', 'moins de 20 tokens ou moins de 72 h : échantillon trop mince');
  assert.equal(thin.hits, 1);
  assert.ok(Math.abs(thin.avgGainPct - (100 - 37.9) / 2) < 0.1);
  assert.ok(Math.abs(thin.minBuySol - 0.038 / 0.3105) < 0.002);
  const rows = Array.from({ length: 24 }, (_, i) => ({ createdAt: i * 4 * 3600, ...(i % 3 === 0 ? win : loss) }));
  assert.equal(summarizeSample(rows).verdict, 'qualified');
  assert.equal(summarizeSample(rows.map((x) => ({ ...x, ...loss }))).verdict, 'negative');
});

test('scanner : avancement vers la migration calculé depuis le prix', async () => {
  const { progressOf } = await import('../src/scanner.js');
  assert.equal(progressOf(30 / 1.073e9), 0, 'prix de départ');
  assert.ok(Math.abs(progressOf(115.005 / 279.9e6) - 1) < 0.001, 'prix de migration');
  assert.ok(Math.abs(progressOf(2.25e-7) - 0.876) < 0.005);
  assert.equal(progressOf(0), null);
});

test('déduit le schéma exchange quand le dev est financé directement', async () => {
  const solo = await run(L1); // Lie1 : financé par Binance, aucun lien de financement avec le reste
  assert.equal(solo.pattern.type, 'exchange');
  assert.deepEqual(solo.chain, [L1]);
  assert.ok(solo.wallets.some((x) => x.address === D1 && x.link?.type === 'deposit'), 'retrouve Dev1 par l\'adresse de dépôt');
});

test('chaîne dev → relais → dev : on suit le dernier dev, relais signalés', async () => {
  const [O, A, RA, B, RB, C] = ['Origine', 'DevA', 'RelaisA', 'DevB', 'RelaisB', 'DevC'];
  const world = [
    send('c1', 10, O, A, 5),
    pump('c2', 20, A, 'MintA', 1e8, -2, mint('MintA', 'aaa')), pump('c3', 30, A, 'MintA', -1e8, 6),
    send('c4', 40, A, RA, 8), send('c5', 41, RA, B, 8),
    pump('c6', 50, B, 'MintB', 1e8, -2, mint('MintB', 'bbb')), pump('c7', 60, B, 'MintB', -1e8, 7),
    send('c8', 70, B, RB, 12), send('c9', 71, RB, C, 12),
    pump('c10', 80, C, 'MintC', 1e8, -2, mint('MintC', 'ccc')), pump('c11', 90, C, 'MintC', -1e8, 9),
  ];
  const id = Object.fromEntries(world.map((t) => [t.sig, t]));
  const hist = {};
  for (const t of [...world].sort((a, b) => b.time - a.time)) {
    for (const a of new Set([...t.signers, ...t.transfers.flatMap((x) => [x.from, x.to])])) (hist[a] ||= []).push(t.sig);
  }
  const fake = {
    calls: 0, cacheHits: 0,
    async sigsPage(address) { return (hist[address] || []).map((s) => ({ signature: s, blockTime: id[s].time, err: null })); },
    async tx(sig) { return id[sig]; },
    async balances(list) { return Object.fromEntries(list.map((a) => [a, a === C ? 15 * SOL : 0])); },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  let res;
  try { res = await trace(C, fake, { ...PRESETS.normal, now: 100 }); } finally { globalThis.fetch = realFetch; }
  assert.equal(res.pattern.type, 'chain');
  assert.equal(res.tracker.verdict, 'track');
  assert.equal(res.tracker.kind, 'chain');
  assert.equal(res.tracker.address, C, 'le dernier dev de la chaîne');
  assert.equal(res.tracker.relays, 2);
  assert.equal(res.tokens.length, 3, 'tous les tokens de la chaîne');
});

// petit monde de test : historique par adresse, du plus récent au plus ancien
function world(list, balances = {}) {
  const id = Object.fromEntries(list.map((t) => [t.sig, t]));
  const hist = {};
  for (const t of [...list].sort((a, b) => b.time - a.time)) {
    for (const a of new Set([...t.signers, ...t.transfers.flatMap((x) => [x.from, x.to])])) (hist[a] ||= []).push(t.sig);
  }
  return {
    calls: 0, cacheHits: 0,
    async sigsPage(address) { return (hist[address] || []).map((s) => ({ signature: s, blockTime: id[s].time, err: null })); },
    async tx(sig) { return id[sig]; },
    async balances(l) { return Object.fromEntries(l.map((a) => [a, (balances[a] || 0) * SOL])); },
  };
}
async function runOn(rpcW, start, now) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try { return await trace(start, rpcW, { ...PRESETS.normal, now }); } finally { globalThis.fetch = realFetch; }
}

test('après : depuis le premier dev, on retrouve les devs suivants et leur route', async () => {
  const [O, A, RA, B, RB, C] = ['Origine', 'DevA', 'RelaisA', 'DevB', 'RelaisB', 'DevC'];
  const w = world([
    send('d1', 10, O, A, 5),
    pump('d2', 20, A, 'MintA', 1e8, -2, mint('MintA', 'aaa')), pump('d3', 30, A, 'MintA', -1e8, 6),
    send('d4', 40, A, RA, 8), send('d5', 41, RA, B, 8),
    pump('d6', 50, B, 'MintB', 1e8, -2, mint('MintB', 'bbb')), pump('d7', 60, B, 'MintB', -1e8, 7),
    send('d8', 70, B, RB, 12), send('d9', 71, RB, C, 12),
    pump('d10', 80, C, 'MintC', 1e8, -2, mint('MintC', 'ccc')),
  ], { [C]: 10 });
  const res = await runOn(w, A, 100);
  if (process.env.DEBUG_T) console.log(JSON.stringify({ advice: res.advice, census: res.census }, null, 1));
  const after = [...res.tokens.filter((t) => t.side === 'after'), ...res.after];
  assert.deepEqual(after.map((t) => t.mint).sort(), ['MintB', 'MintC']);
  const tc = after.find((t) => t.mint === 'MintC');
  assert.deepEqual(tc.route.steps.map((s) => s.address), [A, RA, B, RB, C], 'la route passe par les relais');
  assert.match(tc.logic, /relais/);
  assert.equal(res.advice.verdict, 'track');
  assert.equal(res.advice.mode, 'last', 'chaîne : Dernier Transfert');
  assert.equal(res.advice.address, C, 'on suit le dernier dev trouvé');
});

// Le monde « wallet central » : la source rug, envoie via un relais à un wallet central qui finance 2 devs.
function hubWorld(reused) {
  const [S, R1, H, D1, D2, R2, N] = ['Source', 'Relais1', 'Central', 'NouveauDev1', 'NouveauDev2', 'Relais2', 'Suite'];
  const bundles = ['Achat1', 'Achat2', 'Achat3', 'Achat4'];
  const t2 = reused ? 5000 : 41; // réutilisé : il revient plus d'une heure après pour financer le 2e dev
  return {
    ids: { S, H, N },
    rpc: world([
      pump('h1', 10, S, 'MintS', 1e8, -1, mint('MintS', 'sss')), pump('h2', 20, S, 'MintS', -1e8, 60),
      send('h3', 30, S, R1, 50), send('h4', 31, R1, H, 50),
      send('h5', 40, H, D1, 2.0001), send('h6', t2, H, D2, 2.0002),
      ...bundles.map((b, i) => send(`hb${i}`, 42 + i, H, b, 0.5)),
      send('h7', 50, H, R2, 40), send('h8', 51, R2, N, 40),
      pump('h9', 60, D1, 'MintD1', 1e8, -1.5, mint('MintD1', 'ddd')),
      pump('h10', t2 + 30, D2, 'MintD2', 1e8, -1.5, mint('MintD2', 'eee')),
    ], { [N]: 40 }),
  };
}

test('après : un wallet central réutilisé qui finance ses devs au même montant donne une plage', async () => {
  const { ids, rpc: w } = hubWorld(true);
  const res = await runOn(w, ids.S, 6000);
  assert.deepEqual(res.after.filter((t) => !t.groupBuy).map((t) => t.mint).sort(), ['MintD1', 'MintD2']);
  assert.equal(res.advice.address, ids.H, 'on suit le wallet central, pas les devs jetables');
  assert.equal(res.advice.mode, 'hybrid', 'il finance à montant fixe et se vide vers un relais');
  assert.deepEqual(res.advice.ranges, [[1.9901, 2.0102]], 'wallet mère : ±0,01 SOL autour de ses montants');
  assert.equal(res.advice.verdict, 'track');
});

test('après : wallet central jetable, on donne là où son argent est posé maintenant', async () => {
  const { ids, rpc: w } = hubWorld(false);
  const res = await runOn(w, ids.S, 200);
  assert.equal(res.flow.end, 'rest');
  assert.equal(res.flow.frontier.address, ids.N);
  assert.equal(res.advice.address, ids.N, 'le wallet central jetable ne resservira pas : on prend le wallet où dort le SOL');
  assert.equal(res.advice.mode, 'last');
  assert.equal(res.advice.urgent, true);
});

test('après : argent éparpillé, trop tard pour ce cycle', async () => {
  const [S, H] = ['Src', 'Hub'];
  const small = Array.from({ length: 8 }, (_, i) => `Petit${i}`);
  const w = world([
    pump('s1', 10, S, 'MintX', 1e8, -1, mint('MintX', 'xxx')), pump('s2', 20, S, 'MintX', -1e8, 30),
    send('s3', 30, S, H, 28),
    ...small.map((b, i) => send(`sp${i}`, 40 + i, H, b, 3.4)),
  ], {});
  const res = await runOn(w, S, 9000);
  assert.equal(res.advice.verdict, 'late');
  assert.ok(!res.advice.address, 'aucune adresse morte à coller dans le bot');
});

test('backtest : entrée fin de la 1re bougie (1 seconde), +100 % si touché, sinon perte jusqu\'au plus bas', async () => {
  const { backtestPoints, summarizeBacktest } = await import('../src/qualify.js');
  // seconde 100 : création et bundle, clôture de la 1re bougie à 40 SOL de MC
  const win = backtestPoints([{ t: 100, mc: 30 }, { t: 100, mc: 40 }, { t: 101, mc: 35 }, { t: 105, mc: 81 }, { t: 110, mc: 28 }], 100);
  assert.equal(win.entryMcSol, 40);
  assert.equal(win.outcome, 'tp', 'le prix touche 80 (2 fois l\'entrée) : vendu à +100 %');
  assert.equal(win.pct, 100);
  assert.equal(win.seconds, 5);
  const late = backtestPoints([{ t: 100, mc: 40 }, { t: 101, mc: 30 }, { t: 160, mc: 85 }], 100);
  assert.equal(late.outcome, 'tp', 'sans stop, un +100 % après une baisse compte quand même');
  const loss = backtestPoints([{ t: 100, mc: 40 }, { t: 101, mc: 70 }, { t: 103, mc: 29 }, { t: 120, mc: 31 }], 100);
  assert.equal(loss.outcome, 'loss');
  assert.ok(Math.abs(loss.pct + 27.5) < 0.01, 'perte de 40 jusqu\'au plus bas, 29 : -27,5 %');
  const sum = summarizeBacktest([win, loss], 1);
  assert.equal(sum.tp, 1);
  assert.ok(Math.abs(sum.pnlSol - (1 * (100 - 27.5) / 100 - 2 * 0.038)) < 0.001);
});

test('plages : une plage par montant utilisé, ±0,0001 pour un exchange, ±0,01 pour un wallet mère, 5 au plus', async () => {
  const { buildRanges, inRanges } = await import('../src/census.js');
  const cex = buildRanges([1.994, 1.994, 1.99405, 2.5], 0.0001);
  assert.deepEqual(cex[0], { min: 1.9939, max: 1.9942, n: 3, amount: 1.994 }, 'les 3 envois de 1,994 forment une plage étroite');
  assert.equal(cex[1].n, 1);
  const mere = buildRanges([1.3, 1.5, 1.58, 2, 2.005, 3, 4, 5], 0.01);
  assert.equal(mere.length, 5, '5 plages au plus dans le bot');
  assert.deepEqual(mere[0], { min: 1.99, max: 2.015, n: 2, amount: 2.0025 }, 'la plus utilisée en premier');
  assert.ok(inRanges(1.505, mere) && !inRanges(1.7, mere));
});

test('recensement : remonte les relais jusqu\'à la vraie source, un dev ou une mère n\'est jamais un relais', async () => {
  const { sourcesOf } = await import('../src/census.js');
  const w = {
    Relais1: { funder: 'Mere', fundedSol: 2, txCount: 2 },
    Relais2: { funder: 'Relais3', fundedSol: 1.5, txCount: 2 },
    Relais3: { funder: 'Mere', fundedSol: 1.5, txCount: 2 },
    Mere: { funder: 'Exchange', fundedSol: 50, txCount: 3, children: 3 },
  };
  const src = await sourcesOf([
    { address: 'DevA', funder: 'Relais1', fundedSol: 2 },
    { address: 'DevB', funder: 'Relais2', fundedSol: 1.5 },
    { address: 'DevC', funder: 'DevA', fundedSol: 1 },
  ], async (a) => w[a] || null);
  assert.equal(src[0].source, 'Mere', 'la mère finance 2 devs à travers des relais');
  assert.deepEqual(src[0].devs.map((d) => [d.address, d.amount, d.relays.length]), [['DevA', 2, 1], ['DevB', 1.5, 2]]);
  assert.equal(src.find((s) => s.source === 'DevA').devs[0].address, 'DevC', 'un dev qui finance le suivant reste une source');
});

test('wallet mère qui change d\'adresse : mode Hybride sur la nouvelle mère, plages ±0,01', async () => {
  const [O, M1, M2, A, B, C, D] = ['OrigineH', 'AncienneMere', 'NouvelleMere', 'DevHa', 'DevHb', 'DevHc', 'DevHd'];
  const w = world([
    send('r1', 10, O, M1, 30),
    send('r2', 20, M1, A, 2), pump('r3', 25, A, 'MintHa', 1e8, -1, mint('MintHa', 'ha')),
    send('r4', 30, M1, B, 2), pump('r5', 35, B, 'MintHb', 1e8, -1, mint('MintHb', 'hb')),
    send('r6', 40, M1, M2, 25.9),
    send('r7', 50, M2, C, 2), pump('r8', 55, C, 'MintHc', 1e8, -1, mint('MintHc', 'hc')),
    send('r9', 60, M2, D, 1.5), pump('r10', 65, D, 'MintHd', 1e8, -1, mint('MintHd', 'hd')),
    send('r11', 70, M2, 'DevHe', 2), pump('r12', 75, 'DevHe', 'MintHe', 1e8, -1, mint('MintHe', 'he')),
  ], { [M2]: 20 });
  const res = await runOn(w, C, 100);
  assert.equal(res.census.source, M2, 'la mère actuelle, pas l\'ancienne');
  assert.equal(res.census.rotation?.from, M1, 'l\'ancienne mère lui a tout envoyé');
  assert.equal(res.advice.mode, 'hybrid');
  assert.equal(res.advice.address, M2);
  assert.deepEqual(res.advice.ranges, [[1.99, 2.01], [1.49, 1.51]], 'une plage par montant, la plus utilisée d\'abord');
  assert.equal(res.advice.options.find((o) => o.key === 'inheritSettings').on, true, 'la nouvelle mère doit garder le réglage');
});

test('prix trade par trade depuis les tokens de la courbe (marche aussi hors SOL), lecture jusqu au +400 %', async () => {
  const { curveTrades, backtestPoints } = await import('../src/qualify.js');
  const M = 'MintCourbe'; const CURVE = 'Courbe'; const DEV = 'DevC';
  const trade = (sig, time, curveDelta, extra = {}) => ({ sig, time, solDelta: {}, transfers: [], signers: [], tokenDelta: [{ owner: CURVE, mint: M, delta: curveDelta }], pump: true, ...extra });
  const txs = [
    { ...trade('c0', 100, 1e9 - 30e6), create: { mint: M }, tokenDelta: [{ owner: CURVE, mint: M, delta: 1e9 - 30e6 }, { owner: DEV, mint: M, delta: 30e6 }], solDelta: {} }, // création, coté hors SOL : aucun SOL n'entre
    trade('c1', 100, -50e6), // bundle dans la même seconde
    trade('c2', 103, -20e6),
    trade('c3', 110, -300e6), // grosse montée : 400 M vendus, le prix fait plus que doubler
    trade('c4', 115, 200e6), // le rug, après : lu, car +200 % pas encore touché
  ];
  let pages = 0;
  const fake = { async windowTxs(_a, _f, _t, _c, _o, stop) { const out = []; for (const t of txs) { out.push(t); pages++; if (stop && stop(out)) break; } return { txs: out, capped: false }; } };
  const ct = await curveTrades(fake, M, 100);
  assert.equal(ct.quoteSol, false, 'repéré comme coté hors SOL');
  assert.equal(ct.early, true, '+100 % touché');
  assert.equal(pages, 5, 'on continue après +100 % pour les paliers +200 % / +400 %');
  const b = backtestPoints(ct.points, ct.t0);
  const mc = (sold) => (30 * 1.073e9 / (1.073e9 - sold) ** 2) * 1e9;
  assert.ok(Math.abs(b.entryMcSol - mc(80e6)) < 1e-6, 'entrée = prix après le dernier trade de la seconde de création');
  assert.equal(b.outcome, 'tp');
  assert.equal(b.seconds, 10);
  assert.equal(Math.round(b.strategies.s1.pct), 100);
  assert.ok(b.strategies.s2.pct < 100 && b.strategies.s2.hits === 1, 'le reste après +100 % a pris le rug');
});

test('source : ses autres devs, et les wallets financés dans les plages qui n\'ont encore rien lancé', async () => {
  const { scanSource, buildRanges } = await import('../src/census.js');
  const S = 'SourceX';
  const w = world([
    send('w1', 100, S, 'DevX1', 2), pump('w2', 110, 'DevX1', 'MintX1', 1e8, -1, mint('MintX1', 'x1')),
    send('w3', 200, S, 'RelaisX', 2.005), send('w4', 201, 'RelaisX', 'DevX2', 2), pump('w5', 210, 'DevX2', 'MintX2', 1e8, -1, mint('MintX2', 'x2')),
    send('w6', 300, S, 'Attente', 1.995), // pas encore lancé, garde son SOL
    send('w7', 310, S, 'Vide', 2), send('w8', 320, 'Vide', 'Ailleurs', 0.01),
    send('w9', 400, S, 'HorsPlage', 5),
  ], { Attente: 1.99, Vide: 0.001 });
  const memo = new Map();
  const sigsW = async (a) => { if (!memo.has(a)) memo.set(a, { list: (await w.sigsPage(a)).map((x) => ({ signature: x.signature, time: x.blockTime, err: false })), complete: true }); return memo.get(a); };
  const r = await scanSource(S, buildRanges([2], 0.01), w, sigsW, { from: 0, to: 1000 });
  assert.deepEqual(r.creators.map((c) => c.address).sort(), ['DevX1', 'DevX2'], 'les devs, relais compris');
  assert.deepEqual(r.waiting.map((x) => x.address), ['Attente'], 'financé dans la plage, rien lancé, SOL encore là');
  assert.equal(r.sends, 4, 'l\'envoi de 5 SOL est hors plage');
});

test('un seul dev connu : on retrouve ses frères dans les envois de sa source au même montant', async () => {
  const [S, Me] = ['MereSonde', 'DevSonde'];
  const w = world([
    send('p0', 10, 'OrigineSonde', S, 40),
    send('p1', 100, S, 'FrereA', 1.2), pump('p2', 110, 'FrereA', 'MintFA', 1e8, -1, mint('MintFA', 'fa')),
    send('p3', 200, S, 'RelaisSonde', 1.2), send('p4', 201, 'RelaisSonde', 'FrereB', 1.2), pump('p5', 210, 'FrereB', 'MintFB', 1e8, -1, mint('MintFB', 'fb')),
    send('p6', 300, S, Me, 1.2), pump('p7', 310, Me, 'MintMe', 1e8, -1, mint('MintMe', 'me')),
    send('p8', 320, S, 'Autre', 7),
  ], { [Me]: 0.1 });
  const res = await runOn(w, Me, 400);
  if (process.env.DEBUG_T) console.log(JSON.stringify({ census: res.census, sib: res.siblingTokens, wallets: res.wallets.map((x) => [x.address, x.tokens, x.funder]) }, null, 1));
  assert.equal(res.census?.source, S);
  assert.deepEqual(res.census.devs.map((d) => d.address).sort(), [Me, 'FrereA', 'FrereB'].sort());
  assert.ok([...res.tokens, ...res.siblingTokens].some((t) => t.mint === 'MintFB'), 'le token du frère passé par un relais est dans la liste');
  assert.deepEqual(res.advice.ranges, [[1.19, 1.21]], 'une seule plage : il envoie toujours 1,2 SOL');
  assert.equal(res.advice.address, S, 'on suit la mère');
});

test('mouvements cachés : SOL déplacé par un programme sans transfert visible', async () => {
  const { hiddenMoves, activity } = await import('../src/downstream.js');
  // le wallet reçoit 7 SOL et les perd dans la même transaction, sans transfert sortant : le compte qui gagne les a reçus
  const t = { transfers: [{ from: 'Avant', to: 'Temp', lamports: 7 * SOL }], solDelta: { Avant: -7 * SOL, Temp: 0, Suivant: 7 * SOL - 5000, Frais: 5000 } };
  assert.deepEqual(hiddenMoves(t, 'Temp').map((x) => [x.to, x.lamports]), [['Suivant', 7 * SOL - 5000]]);
  assert.deepEqual(hiddenMoves({ transfers: [], solDelta: { X: -0.001 * SOL, Y: 0.001 * SOL } }, 'X'), [], 'les petites sommes (frais) ne comptent pas');
  // activité : une seule rafale = jetable ; deux rafales à plus d'une heure d'écart = réutilisé
  assert.equal(activity([{ time: 100 }, { time: 130 }, { time: 400 }]).reused, false);
  assert.equal(activity([{ time: 100 }, { time: 5000 }]).reused, true);
});

test('exchange : même montant exact chez 2 devs, plage à ±0,0001 sur l\'exchange, pas sur le dev jetable', async () => {
  const BIN = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
  const w = world([
    send('e1', 100, BIN, 'DevE1', 1.994), pump('e2', 110, 'DevE1', 'MintE1', 1e8, -1, mint('MintE1', 'e1')), pump('e3', 120, 'DevE1', 'MintE1', -1e8, 3),
    send('e4', 130, 'DevE1', 'DepotE', 2.9), send('e5', 140, 'DepotE', BIN, 2.9),
    send('e6', 200, BIN, 'DevE2', 1.994), pump('e7', 210, 'DevE2', 'MintE2', 1e8, -1, mint('MintE2', 'e2')), pump('e8', 220, 'DevE2', 'MintE2', -1e8, 3),
    send('e9', 230, 'DevE2', 'DepotE', 2.9),
  ], {});
  const res = await runOn(w, 'DevE2', 300);
  assert.equal(res.advice.verdict, 'track');
  assert.equal(res.advice.address, BIN, 'on suit l\'exchange');
  assert.equal(res.advice.mode, 'exchange');
  assert.deepEqual(res.advice.ranges, [[1.9939, 1.9941]], 'plage à ±0,0001 autour du montant exact');
});

test('délai de snipe : proposé seulement si ses ratés tombent vite et ses bons tokens mettent plus longtemps', async () => {
  const { suggestDelay } = await import('../src/qualify.js');
  const loss = (d) => ({ outcome: 'loss', pct: -40, dropSeconds: d });
  const win = (s) => ({ outcome: 'tp', pct: 100, seconds: s });
  assert.deepEqual(suggestDelay([loss(1), loss(2), loss(3), win(20), win(40)]), { delay: 4, losersFiltered: 3, losers: 3, winsKept: 2, wins: 2 });
  assert.equal(suggestDelay([loss(1), loss(2), win(2), win(3)]), null, 'ses bons tokens partent aussi vite : un délai les ferait rater');
  assert.equal(suggestDelay([loss(60), loss(90), win(20)]), null, 'ses ratés tombent lentement : pas de délai utile');
});

test('plages d\'un wallet mère : tolérance de 3 % du montant, plafonnée à ±0,01 SOL', async () => {
  const { buildRanges, TOL } = await import('../src/census.js');
  assert.deepEqual(buildRanges([2], TOL.mother)[0], { min: 1.99, max: 2.01, n: 1, amount: 2 }, '2 SOL : ±0,01');
  const small = buildRanges([0.0244], TOL.mother)[0];
  assert.ok(small.max - small.min < 0.002, 'un petit montant garde une plage étroite');
});

test('mémoire des enquêtes : un autre dev déjà vu au même montant exact du même exchange confirme le schéma', async () => {
  const BIN = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
  const w = world([
    send('m1', 100, BIN, 'DevMemo', 1.7321), pump('m2', 110, 'DevMemo', 'MintMemo', 1e8, -1, mint('MintMemo', 'memo')), pump('m3', 120, 'DevMemo', 'MintMemo', -1e8, 3),
  ], {});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  let sans; let avec;
  try {
    sans = await trace('DevMemo', w, { ...PRESETS.normal, now: 200 });
    avec = await trace('DevMemo', w, { ...PRESETS.normal, now: 200, history: [{ source: BIN, dev: 'AncienDev', sol: 1.73212, inv: 'x', start: 'AncienDevStart' }] });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sans.advice.verdict, 'wait', 'seul, le montant ne prouve rien');
  assert.equal(avec.advice.verdict, 'track', 'déjà vu dans une autre enquête : schéma confirmé');
  assert.equal(avec.advice.address, BIN);
  assert.deepEqual(avec.advice.ranges, [[1.732, 1.7322]]);
});

test('adresse qui n\'a jamais signé : dite « pas un dev » au lieu d\'un schéma non identifié', async () => {
  const w = world([send('pa1', 100, 'SpammeurX', 'Passif1', 0.002), send('pa2', 110, 'SpammeurX', 'Passif1', 0.002)], {});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  let r;
  try { r = await trace('Passif1', w, { ...PRESETS.normal, now: 200 }); } finally { globalThis.fetch = realFetch; }
  assert.equal(r.advice.verdict, 'reject');
  assert.ok(r.advice.notDev);
  assert.equal(r.pattern.title, 'Pas un dev');
  assert.match(r.advice.reason, /Spam…/);
});

test('mère à 3 devs financée par un exchange confirmé : la mère d\'abord, l\'exchange en 2e tracker sans héritage', async () => {
  const { adviseBot } = await import('../src/advice.js');
  const census = {
    source: 'MereX', label: null, kind: 'mother', freshShare: 1, sourceCreates: 15,
    devs: [{ address: 'D1', amount: 0.0238 }, { address: 'D2', amount: 0.0238 }, { address: 'D3', amount: 0.0239 }],
    ranges: [{ min: 0.0231, max: 0.0245, n: 3, amount: 0.0238 }], activity: { reused: true, lastAt: 90 }, others: [],
  };
  const base = { verdict: 'track', kind: 'cex', address: 'BinanceX', name: 'Binance', minSol: 1.0279, maxSol: 1.0281, reason: 'x' };
  const a = adviseBot({ start: 'D1', base, fwd: { nodes: [] }, after: [], startTokens: 1, census, now: 100 });
  assert.equal(a.verdict, 'track');
  assert.equal(a.address, 'MereX');
  assert.deepEqual(a.also.range, [1.0279, 1.0281]);
  assert.equal(a.also.address, 'BinanceX');
  assert.match(a.tip, /copytrade/);
  const seul = adviseBot({ start: 'D1', base, fwd: { nodes: [] }, after: [], startTokens: 1, census: { ...census, devs: census.devs.slice(0, 2) }, now: 100 });
  assert.equal(seul.address, 'BinanceX', 'avec seulement 2 devs, l\'exchange confirmé reste devant');
});

test('mère qui finance ses devs dans une transaction pump.fun : le virement direct compte, pas l\'achat', async () => {
  const M = 'MerePump';
  const fund = (sig, time, to, sol) => ({ ...send(sig, time, M, to, sol), pump: true,
    transfers: [{ from: M, to, lamports: sol * SOL, top: true }, { from: M, to: 'CourbeX', lamports: 0.0238 * SOL, top: false }] });
  const w = world([
    send('q0', 5, 'OrigineQ', M, 5),
    fund('q1', 10, 'DevQa', 0.0238), pump('q2', 12, 'DevQa', 'MintQa', 1e8, -0.02, mint('MintQa', 'qa')),
    fund('q3', 20, 'DevQb', 0.0238), pump('q4', 22, 'DevQb', 'MintQb', 1e8, -0.02, mint('MintQb', 'qb')),
    fund('q5', 30, 'DevQc', 0.0239), pump('q6', 32, 'DevQc', 'MintQc', 1e8, -0.02, mint('MintQc', 'qc')),
  ], { [M]: 3 });
  const res = await runOn(w, 'DevQa', 100);
  assert.equal(res.census?.source, M);
  assert.equal(res.advice.address, M);
  assert.ok(res.census.scan?.sends >= 2, 'les envois dans des transactions pump.fun sont lus');
  assert.ok(!res.advice.ranges.some(([a, b]) => a <= 0.0238 * 2 && b >= 0.0476 && b - a > 0.01), 'plage étroite autour de 0,0238');
});

test('inactif : aucun token depuis plus de 24 h (lui ou ses autres devs) → pas intéressant', async () => {
  assert.ok(r.lastLaunchAt > 0, 'dernier lancement connu');
  assert.ok(!r.advice.inactive, 'actif au moment de la traque');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  let old;
  try { old = await trace(D1, rpc, { ...PRESETS.normal, now: r.lastLaunchAt + 3 * 86400 }); } finally { globalThis.fetch = realFetch; }
  assert.ok(old.lastLaunchAt > 0 && old.lastLaunchAt <= r.lastLaunchAt);
  assert.equal(old.advice.inactive, true);
  assert.match(old.advice.inactiveReason, /depuis 3 jours/);
  // calcul de secours pour les anciennes enquêtes sans lastLaunchAt
  const { lastLaunchOf } = await import('../src/advice.js');
  assert.equal(lastLaunchOf({ tokens: [{ createdAt: 10 }, { createdAt: 50, groupBuy: true }], siblingTokens: [{ createdAt: 30 }] }), 30);
  assert.equal(lastLaunchOf({ tokens: [] }), null);
});

test('stratégies de vente : tout à +100 %, 50/50, 50/25/25 (part du sac restant)', async () => {
  const { simulate, STRATEGIES, summarizeBacktest, backtestPoints } = await import('../src/qualify.js');
  const pts = (arr) => arr.map((mc, i) => ({ t: i + 1, mc }));
  const [s1, s2, s3] = STRATEGIES.map((s) => s.levels);
  // entrée 40, monte à 2,5x puis rug à 28 : le reste après +100 % est perdu jusqu'au plus bas
  const a = pts([60, 100, 70, 28]);
  assert.equal(Math.round(simulate(a, 40, s1).pct), 100);
  assert.equal(Math.round(simulate(a, 40, s2).pct), 35); // 0,5×2 + 0,5×0,7
  assert.equal(Math.round(simulate(a, 40, s3).pct), 35);
  // monte à 5,5x : tous les paliers
  const b = pts([90, 130, 220, 28]);
  assert.equal(Math.round(simulate(b, 40, s2).pct), 150);
  assert.equal(Math.round(simulate(b, 40, s3).pct), 200); // 0,5×2 + 0,25×3 + 0,25×5
  // jamais +100 % : même perte pour les 3
  const c = pts([45, 30, 28]);
  for (const l of [s1, s2, s3]) assert.equal(Math.round(simulate(c, 40, l).pct), -30);
  // migré avant +400 % : le reste sort au prix de migration
  assert.equal(Math.round(simulate(pts([90, 130, 150]), 40, s3, true).pct), Math.round((0.5 * 2 + 0.25 * 3 + 0.25 * 150 / 40 - 1) * 100));
  const bt = backtestPoints([{ t: 0, mc: 40 }, ...b], 0);
  const sum = summarizeBacktest([bt], 1);
  assert.deepEqual(sum.strategies.map((x) => Math.round(x.pnlSol * 1000)), [1000 - 38, 1500 - 38, 2000 - 38]);
});

test('équipes : même mère, ou même exchange au même montant exact', async () => {
  const { teamKeys } = await import('../src/advice.js');
  const M = 'Mere1111111111111111111111111111111111111111';
  const X = 'Bin11111111111111111111111111111111111111111';
  const a = teamKeys({ start: 'A', census: { kind: 'mother', source: M, ranges: [{ min: 1.99, max: 2.01 }] }, advice: { verdict: 'track', mode: 'exchange', address: M, evidence: 'census', also: { address: X, name: 'Binance', range: [1.0279, 1.0281] } } });
  const b = teamKeys({ start: 'B', advice: { verdict: 'track', mode: 'exchange', address: X, name: 'Binance', ranges: [1.0279, 1.0281], evidence: 'before' } });
  const c = teamKeys({ start: 'C', advice: { verdict: 'track', mode: 'exchange', address: X, name: 'Binance', ranges: [0.4999, 0.5001], evidence: 'before' } });
  assert.ok(a.some((k) => k.key === M && k.kind === 'mother'));
  const shared = (p, q) => p.some((k) => q.some((j) => j.key === k.key));
  assert.ok(shared(a, b), 'même Binance à 1,0280 → même équipe');
  assert.ok(!shared(b, c), 'Binance à un autre montant → pas la même équipe');
  assert.deepEqual(teamKeys({ start: 'D', advice: { verdict: 'track', mode: 'last', address: 'D2' } }), [], 'Dernier Transfert : pas de source partagée');
});

test('achat sur vente du dev : repère sa 1re vente, achète juste après, mêmes stratégies', async () => {
  const { curveTrades, devSellTrade, summarizeDevSell } = await import('../src/qualify.js');
  const M = 'MintDS'; const CURVE = 'CourbeDS'; const DEV = 'DevDS';
  const tx = (sig, time, curveDelta, devDelta = 0) => ({ sig, time, solDelta: {}, transfers: [], signers: [], feePayer: 'X', pump: true,
    tokenDelta: [{ owner: CURVE, mint: M, delta: curveDelta }, ...(devDelta ? [{ owner: DEV, mint: M, delta: devDelta }] : [])] });
  const txs = [
    { ...tx('d0', 100, 1e9 - 50e6, 50e6), create: { mint: M }, feePayer: DEV }, // création + achat du dev (5 % de la supply)
    tx('d1', 101, -30e6),
    tx('d2', 104, 50e6, -50e6), // le dev vend tout : 5 % de la supply
    tx('d3', 110, -350e6), // ça monte fort après sa vente
    tx('d4', 120, 350e6), // puis ça retombe
  ];
  const fake = { async windowTxs(_a, _f, _t, _c, _o, stop) { const out = []; for (const t of txs) { out.push(t); if (stop && stop(out)) break; } return { txs: out, capped: false }; } };
  const ct = await curveTrades(fake, M, 100, { dev: DEV });
  assert.equal(ct.devSell.t, 104);
  assert.ok(Math.abs(ct.devSell.pctSupply - 5) < 1e-9, '5 % de la supply');
  assert.equal(Math.round(ct.devSell.pctBag), 100, 'tout son sac');
  const d = devSellTrade(ct);
  assert.equal(d.sold, true);
  assert.equal(d.seconds, 4);
  assert.ok(d.strategies.s1.pct === 100, '+100 % touché après sa vente');
  const sum = summarizeDevSell([d, { sold: false }], 1);
  assert.equal(sum.sold, 1); assert.equal(sum.share, 0.5);
  assert.deepEqual(sum.range, [4, 6]);
  assert.equal(Math.round(sum.strategies[0].pnlSol * 1000), 1000 - 38, 'un seul achat (le token sans vente du dev ne coûte rien)');
});

test('snipers : premiers acheteurs, wallets qui reviennent, copie à la clôture de sa bougie', async () => {
  const { earlyBuyersFrom, rankEarlyWallets, recentBuysFrom, copyTrade } = await import('../src/snipers.js');
  const M = 'MintS'; const C = 'CurveS'; const DEV = 'DevS';
  const buy = (sig, time, who, n = 10e6) => ({ sig, time, pump: true, solDelta: { [who]: -0.5e9 }, transfers: [], signers: [who], feePayer: who, tokenDelta: [{ owner: C, mint: M, delta: -n }, { owner: who, mint: M, delta: n }] });
  const txs = [
    { sig: 'c', time: 100, pump: true, create: { mint: M }, feePayer: DEV, signers: [DEV], solDelta: {}, transfers: [], tokenDelta: [{ owner: C, mint: M, delta: 1e9 - 20e6 }, { owner: DEV, mint: M, delta: 20e6 }] },
    buy('b1', 100, 'Sniper1'), buy('b2', 100, 'Bundle1'), buy('b3', 101, 'Sniper2'), buy('b4', 101, 'Sniper1'),
  ];
  const eb = earlyBuyersFrom(txs, M, DEV);
  assert.deepEqual(eb.buyers.map((b) => b.wallet), ['Sniper1', 'Bundle1', 'Sniper2'], 'le dev exclu, un wallet compté une fois');
  assert.equal(eb.buyers[2].delay, 1);
  const ranked = rankEarlyWallets([
    { buyers: [{ wallet: 'A', rank: 1, delay: 0 }, { wallet: 'B', rank: 2, delay: 0 }] },
    { buyers: [{ wallet: 'A', rank: 2, delay: 0 }, { wallet: 'C', rank: 1, delay: 0 }] },
    { buyers: [{ wallet: 'A', rank: 1, delay: 1 }, { wallet: 'B', rank: 9, delay: 30 }] },
  ]);
  assert.deepEqual(ranked.map((x) => [x.wallet, x.tokens]), [['A', 3]], 'B trop tard sur le 3e token : une seule apparition');
  const rb = recentBuysFrom([buy('x2', 200, 'W'), buy('x1', 150, 'W'), { ...buy('y', 120, 'W'), tokenDelta: [{ owner: 'W', mint: 'M2', delta: 5 }, { owner: 'P', mint: 'M2', delta: -5 }] }], 'W');
  assert.deepEqual(rb.buys.map((b) => [b.mint, b.time]), [['MintS', 150], ['M2', 120]], 'premier achat par token');
  // copie : entrée = clôture de la seconde de son achat, ensuite +100 % puis rug
  const ct = { t0: 100, migrated: false, points: [{ t: 100, mc: 30 }, { t: 102, mc: 38 }, { t: 102, mc: 40 }, { t: 105, mc: 85 }, { t: 110, mc: 28 }] };
  const cp = copyTrade(ct, 102);
  assert.equal(cp.entryMcSol, 40);
  assert.equal(cp.delay, 2);
  assert.equal(Math.round(cp.strategies.s1.pct), 100);
  assert.equal(Math.round(cp.strategies.s2.pct), 35); // 0,5×2 + 0,5×0,7
});

test('perte max sur un raté : −30 % au pire, moins si le prix descend moins', async () => {
  const { simulate, cappedPct, STRATEGIES } = await import('../src/qualify.js');
  const pts = (arr) => arr.map((mc, i) => ({ t: i + 1, mc }));
  const [s1, s2] = STRATEGIES.map((s) => s.levels);
  const rug = simulate(pts([90, 60, 28]), 95, s1); // entrée haute, chute au plancher : −71 % au plus bas
  assert.equal(Math.round(rug.pct), -71);
  assert.equal(Math.round(cappedPct(rug, 0.3)), -30, 'il sort à −30 %');
  assert.equal(Math.round(cappedPct(rug, null)), -71, 'au plus bas si on le demande');
  const soft = simulate(pts([38, 36]), 40, s1); // le prix ne descend que de 10 %
  assert.equal(Math.round(cappedPct(soft, 0.3)), -10);
  const half = simulate(pts([85, 100, 28]), 40, s2); // 50 % vendus à +100 %, le reste plafonné à −30 %
  assert.equal(Math.round(cappedPct(half, 0.3)), Math.round((0.5 * 2 + 0.5 * 0.7 - 1) * 100));
});

test('bilan réel : achats et ventes du wallet par token, SOL et wSOL, lien avec les enquêtes', async () => {
  const { tradesFrom, indexInvestigations } = await import('../src/realpnl.js');
  const W = 'Moi'; const WSOL = 'So11111111111111111111111111111111111111112';
  const tx = (time, mint, delta, lamports, wsol = 0) => ({ time, solDelta: { [W]: lamports }, tokenDelta: [{ owner: W, mint, delta }, ...(wsol ? [{ owner: W, mint: WSOL, delta: wsol }] : [])] });
  const trades = tradesFrom([
    tx(100, 'A', 1000, -0.15e9), tx(110, 'A', -500, 0.15e9), tx(120, 'A', -500, 0.1e9), // A : 0,15 → 0,25 SOL
    tx(200, 'B', 1000, -0.05e9, -0.1), tx(210, 'B', -1000, 0.03e9), // B : 0,15 (dont 0,1 en wSOL) → 0,03
    tx(300, 'C', 1000, -0.15e9), // C : encore ouvert
  ], W);
  const by = Object.fromEntries(trades.map((t) => [t.mint, t]));
  assert.equal(Math.round(by.A.pnlSol * 100), 10);
  assert.equal(Math.round(by.A.pct), 67);
  assert.equal(Math.round(by.B.spent * 100), 15, 'le wSOL dépensé compte');
  assert.equal(Math.round(by.B.pct), -80);
  assert.equal(by.C.closed, false);
  const idx = indexInvestigations([{ id: 'inv1', start: 'Dev1', census: { devs: [{ address: 'Dev2' }] }, tokens: [{ creator: 'Dev1' }], qualification: { tokens: [{ mint: 'A', bt: { pct: 100, strategies: { s1: { pct: 100 }, s2: { pct: 50 }, s3: { pct: 80 } } } }] } }]);
  assert.equal(idx.byCreator.get('Dev2').id, 'inv1', 'un autre dev de la même mère pointe vers la même enquête');
  assert.equal(idx.byMint.get('A').id, 'inv1');
  assert.equal(Math.round(idx.byCreator.get('Dev1').predicted.s3), 80);
});

test('chasse : un rugger n’est retenu que trackable, actif, avec assez de tokens et rentable', async () => {
  const { judge } = await import('../src/hunt.js');
  const ok = { verdict: 'track', inactive: false, n: 10, bestPnl: 1.2 };
  assert.equal(judge(ok), 'keep');
  assert.equal(judge({ ...ok, verdict: 'lost' }), 'notTrackable');
  assert.equal(judge({ ...ok, verdict: 'reject' }), 'notTrackable');
  assert.equal(judge({ ...ok, notDev: true }), 'notTrackable');
  assert.equal(judge({ ...ok, inactive: true }), 'inactive');
  assert.equal(judge({ ...ok, n: 3 }), 'thin');
  assert.equal(judge({ ...ok, bestPnl: -0.01 }), 'notProfitable');
  assert.equal(judge({ ...ok, bestPnl: 0.5 }), 'notProfitable', 'positif mais moins de 1 SOL pour 10 lancements');
  assert.equal(judge({ ...ok, n: 5, bestPnl: 0.5 }), 'keep', '0,5 SOL sur 5 lancements = 1 SOL pour 10');
});

test('rug sur la courbe : une seule vente qui fait chuter le prix d’au moins 35 %', async () => {
  const { maxSingleDrop, RUG_DROP } = await import('../src/snipers.js');
  const pts = (arr) => arr.map((mc, i) => ({ t: i, mc }));
  assert.ok(maxSingleDrop(pts([40, 80, 120, 50, 30])) >= RUG_DROP, '120 → 50 d’un coup : rug');
  assert.ok(maxSingleDrop(pts([40, 60, 55, 50, 45, 40, 35])) < RUG_DROP, 'lente descente : pas un rug');
  const { isRugCurve } = await import('../src/snipers.js');
  const steps = [80, 70, 60, 50, 40, 30].map((mc, i) => ({ t: 100 + i * 5, mc })); // −62 % en 25 s, ventes de −12 à −25 %
  assert.equal(isRugCurve(steps, false), true, 'dump en plusieurs ventes rapprochées : rug');
  assert.equal(isRugCurve(steps, true), false, 'migré : pas un rug');
  assert.equal(isRugCurve([80, 70, 60, 50, 40, 30].map((mc, i) => ({ t: i * 600, mc })), false), false, 'lente descente sur une heure : pas un rug');
});

test('stratégie d’un wallet : scalping, mise, temps de détention, gains et pertes', async () => {
  const { walletStyle } = await import('../src/snipers.js');
  const tr = (spent, pct, hold, buys = 1, sells = 1) => ({ spent, pnlSol: (spent * pct) / 100, pct, firstBuy: 1000, lastSell: 1000 + hold, buys, sells });
  const own = [tr(0.5, 50, 20), tr(0.5, -60, 13), tr(0.5, -60, 12), tr(0.5, -60, 14), tr(0.5, 150, 25, 2)];
  const st = walletStyle(own, { ownHours: 0.5, copies: [{ delay: 0, entryMcSol: 40 }, { delay: 0, entryMcSol: 45 }, { delay: 3, entryMcSol: 60 }], late: 0 });
  assert.equal(st.type, 'Bot de scalping');
  assert.equal(st.trades, 5);
  assert.equal(Math.round(st.winrate * 100), 40);
  assert.equal(Math.round(st.tradesPerHour), 10);
  assert.equal(Math.round(st.size * 100), 50, 'mise par achat : médiane de 0,5 / 0,5 / 0,5 / 0,5 / 0,25 (le token renforcé en 2 achats)');
  assert.ok(st.tags.includes('achète dans la seconde du lancement'));
  assert.ok(Math.abs(st.pnlSol - (0.25 + 0.75 - 0.9)) < 1e-9);
});

test('wallets du rug : rug rapide, bundle + 3-4 premiers acheteurs, verdict à +100 % sous 10 000 $', async () => {
  const { isRugFast, rugWallets, sameRing } = await import('../src/wallethunt.js');
  const { trackerVerdict } = await import('../src/wallettracker.js');
  const pts = (arr, step) => arr.map((mc, i) => ({ t: i * step, mc }));
  assert.equal(isRugFast(pts([100, 90, 25], 2), 0.7), true, '−75 % en 4 s : rug');
  assert.equal(isRugFast(pts([100, 80, 60, 40, 28], 12), 0.7), true, '−72 % en 48 s : rug lent');
  assert.equal(isRugFast(pts([100, 80, 60, 40, 28], 600), 0.7), false, 'sur 40 min : pas un rug');
  const buyers = [{ wallet: 'A', rank: 1, bundle: true }, { wallet: 'B', rank: 2, bundle: true }, { wallet: 'C', rank: 3, bundle: false }, { wallet: 'D', rank: 4, bundle: false }, { wallet: 'E', rank: 5, bundle: false }, { wallet: 'F', rank: 6, bundle: true }];
  assert.deepEqual(rugWallets(buyers, { firstBuyers: 4 }).map((b) => b.wallet), ['A', 'B', 'F', 'C', 'D'], 'tout le bundle + les 4 premiers, pas plus');
  const ok = { counted: 10, hits: 7, pnl100: 1.2, buys24h: 12, creates: 0, pnl30: { closed: 40, pnlSol: 3 } };
  assert.equal(trackerVerdict(ok).good, true);
  assert.equal(trackerVerdict({ ...ok, buys24h: 45 }).good, false, 'plus de 30 trades par jour');
  assert.equal(trackerVerdict({ ...ok, buys24h: 2 }).good, false, 'moins de 3 trades par jour');
  assert.equal(trackerVerdict({ ...ok, pnl100: 0.5 }).good, false, 'moins de 1 SOL pour 10');
  assert.equal(trackerVerdict({ ...ok, counted: 3 }).good, false, 'trop peu d’achats tôt');
  assert.equal(trackerVerdict({ ...ok, pnl30: { closed: 40, pnlSol: -2 } }).good, false, 'négatif sur 30 jours');
  assert.equal(trackerVerdict({ ...ok, creates: 1 }).good, false, 'un dev');
  assert.equal(sameRing(['a', 'b', 'c'], ['b', 'c', 'x']), true);
});

test('chasse par filtres : chiffres de la courbe et critères', async () => {
  const { curveFacts, failCurve, normalizeFilters } = await import('../src/filterhunt.js');
  // 1re bougie à 40 SOL de MC, monte à 120 (+200 %), puis −75 % en 5 s
  const ct = { t0: 100, migrated: false, points: [{ t: 100, mc: 40 }, { t: 110, mc: 80 }, { t: 130, mc: 120 }, { t: 133, mc: 60 }, { t: 135, mc: 30 }] };
  const fx = curveFacts(ct, 100, 60);
  assert.equal(Math.round(fx.entryUsd), 4000);
  assert.equal(Math.round(fx.peakPct), 200);
  assert.equal(Math.round(fx.athUsd), 12000);
  assert.equal(Math.round(fx.rugDropPct), 75);
  assert.equal(fx.rugAfterSec, 30);
  assert.equal(failCurve(fx, normalizeFilters({ maxEntryUsd: 10000, minPeakPct: 100, minRugDrop: 70 })), null);
  assert.ok(failCurve(fx, normalizeFilters({ minPeakPct: 300 })));
  assert.ok(failCurve(fx, normalizeFilters({ maxEntryUsd: 3000 })));
  assert.ok(failCurve(fx, normalizeFilters({ minRugDrop: 80 })));
  assert.ok(failCurve(fx, normalizeFilters({ maxRugAfterSec: 20 })));
  assert.equal(normalizeFilters({ minVolume: '' }).minVolume, null, 'champ vide = pas de filtre');
});

test('hub à deux étages : 7 et 9 SOL à des intermédiaires qui financent chacun des devs', async () => {
  const { findHub, followFanOut } = await import('../src/census.js');
  const SOLL = 1e9; let n = 0;
  const txs = {};
  const byAddr = {};
  const add = (t) => { txs[t.sig] = t; for (const a of new Set([...t.signers, ...t.transfers.flatMap((x) => [x.from, x.to])])) (byAddr[a] ||= []).unshift(t.sig); };
  const send = (from, to, sol, time) => add({ sig: `s${n++}`, time, signers: [from], feePayer: from, transfers: [{ from, to, lamports: sol * SOLL, top: true }], tokenDelta: [], solDelta: {}, pump: false });
  const create = (dev, mint, time) => add({ sig: `c${n++}`, time, signers: [dev], feePayer: dev, transfers: [], tokenDelta: [], solDelta: {}, pump: true, create: { mint, name: mint, symbol: mint } });
  send('Mixeur', 'Hub', 1000, 100);
  send('Hub', 'M1', 7, 200); send('M1', 'D1', 2, 210); send('M1', 'D2', 2, 211); create('D1', 'T1', 220); create('D2', 'T2', 225);
  send('Hub', 'M2', 9, 300); send('M2', 'D3', 3, 310); create('D3', 'T3', 320);
  send('Hub', 'Ami', 5, 400); // un envoi qui ne mène à aucun dev
  const rpc = { async tx(sig) { return txs[sig]; } };
  const sigs = async (a) => ({ list: (byAddr[a] || []).map((s) => ({ signature: s, time: txs[s].time, err: false })), complete: true });
  const fan = await followFanOut('M1', rpc, sigs);
  assert.deepEqual(fan.devs.map((d) => d.address).sort(), ['D1', 'D2'], 'les deux devs de l’intermédiaire, pas seulement le plus gros envoi');
  const hub = await findHub('Hub', rpc, sigs, { from: 0, to: 1000 });
  assert.deepEqual(hub.mids.map((m) => [m.address, m.amount, m.devs.length]).sort(), [['M1', 7, 2], ['M2', 9, 1]]);
  assert.equal(hub.followed, 3, 'l’envoi de 5 SOL à un ami est suivi mais ne mène à rien');
});

test('source du dev : mère probable, relais, dev déjà très utilisé', async () => {
  const { devSource } = await import('../src/devsource.js');
  const SOLL = 1e9; let n = 0; const txs = {}; const by = {};
  const add = (t) => { txs[t.sig] = t; for (const a of new Set([...t.signers, ...t.transfers.flatMap((x) => [x.from, x.to])])) (by[a] ||= []).unshift(t.sig); };
  const send = (from, to, sol, time) => add({ sig: `x${n++}`, time, signers: [from], feePayer: from, transfers: [{ from, to, lamports: sol * SOLL }], tokenDelta: [], solDelta: {} });
  // une mère : finance Dev1, A, B (et a elle-même assez de transactions pour ne pas être un relais)
  send('Ex', 'Mere', 50, 10); send('Mere', 'A', 2, 20); send('Mere', 'B', 2, 30); send('Mere', 'X', 1, 35); send('Mere', 'Dev1', 2, 40);
  // un relais : reçoit puis renvoie tout au dev
  send('Haut', 'Relais', 3, 50); send('Relais', 'Dev2', 2.99, 51);
  const rpc = {
    async sigsPage(a) { return (by[a] || []).map((s) => ({ signature: s, blockTime: txs[s].time, err: null })); },
    async tx(s) { return txs[s]; },
    async balances(list) { return Object.fromEntries(list.map((a) => [a, 0])); },
  };
  const m = await devSource(rpc, 'Dev1', 100);
  assert.equal(m.color, 'green'); assert.equal(m.kind, 'mother'); assert.equal(m.kids, 3);
  const r = await devSource(rpc, 'Dev2', 100);
  assert.equal(r.kind, 'relay'); assert.equal(r.upstream, 'Haut');
  const busy = { ...rpc, async sigsPage() { return Array.from({ length: 1000 }, (_, i) => ({ signature: `z${i}`, blockTime: i, err: null })); } };
  assert.equal((await devSource(busy, 'Vieux', 100)).kind, 'old-dev');
});

test('chemin de l\'argent : envoi caché dans un mini-achat pump.fun, puis le dev suivant relance', async () => {
  const { outMoves, followMainFlow } = await import('../src/downstream.js');
  const { adviseBot } = await import('../src/advice.js');
  const { rankRows } = await import('../src/filterhunt.js');
  // A envoie 30 SOL à B dans une transaction qui fait aussi un mini-achat pump.fun (B co-signe et reçoit 63 000 tokens)
  const hiddenTx = {
    sig: 'h1', time: 100, failed: false, feePayer: 'A', fee: 5000, signers: ['A', 'B'], pump: true, create: null,
    solDelta: { A: -30 * SOL, B: 29.98 * SOL, Curve: 0.01 * SOL },
    tokenDelta: [{ owner: 'Curve', mint: 'Mx', delta: -63000 }, { owner: 'B', mint: 'Mx', delta: 63000 }],
    transfers: [{ from: 'A', to: 'B', lamports: 30 * SOL, top: true }, { from: 'B', to: 'Wsol', lamports: 0.01 * SOL, top: true }, { from: 'B', to: 'Curve', lamports: 0.01 * SOL, top: false }],
  };
  const moves = outMoves(hiddenTx, 'A');
  assert.equal(moves.length, 1); assert.equal(moves[0].to, 'B');
  assert.equal(outMoves(hiddenTx, 'B').length, 0, 'l’emballage WSOL et l’achat ne sont pas des envois');
  // B lance son token avec l'argent
  const createTx = { ...pump('c1', 110, 'B', 'NewMint', 900e6, -29), create: { mint: 'NewMint', name: 'Next', symbol: 'NEXT', uri: 'ipfs://x' } };
  const fund = send('f0', 50, 'Src', 'A', 30);
  const txs = { h1: hiddenTx, c1: createTx, f0: fund };
  const sigsOf = { A: ['h1', 'f0'], B: ['c1', 'h1'] };
  const rpc = { async tx(s) { return txs[s]; }, async balances(list) { return Object.fromEntries(list.map((a) => [a, a === 'B' ? 0.02 * SOL : 0])); } };
  const sigs = async (a) => ({ list: (sigsOf[a] || []).map((s) => ({ signature: s, time: txs[s].time, err: null })).sort((x, y) => y.time - x.time), complete: true });
  const flow = await followMainFlow('A', rpc, sigs);
  assert.deepEqual(flow.path.map((p) => p.address), ['A', 'B']);
  assert.equal(flow.end, 'launched');
  assert.equal(flow.creates[0].mint, 'NewMint');
  const a = adviseBot({ start: 'A', base: { verdict: 'track', kind: 'chain', address: 'A' }, fwd: { nodes: [] }, after: [], startTokens: 1, flow, now: 200 });
  assert.equal(a.verdict, 'track'); assert.equal(a.address, 'B'); assert.equal(a.mode, 'last');
  // classement : rentable en haut, trop tard en bas, analyses pas finies à la fin
  const rows = [
    { mint: 'late', analysis: { status: 'done', verdict: 'late', n: 7, bestPnl: 0.3 } },
    { mint: 'wait', analysis: { status: 'waiting' } },
    { mint: 'data', analysis: { status: 'done', verdict: 'track', n: 2, bestPnl: 0.4 } },
    { mint: 'best', analysis: { status: 'done', verdict: 'track', n: 8, bestPnl: 1.6 } },
    { mint: 'good', analysis: { status: 'done', verdict: 'track', n: 6, bestPnl: 0.7 } },
    { mint: 'meh', analysis: { status: 'done', verdict: 'track', n: 6, bestPnl: 0.2 } },
  ];
  assert.deepEqual(rankRows(rows).map((r) => r.mint), ['best', 'good', 'meh', 'data', 'late', 'wait']);
});

test('chasse : les tokens d\'une même équipe sont regroupés sous le mieux classé', async () => {
  const { groupTeams, rankRows } = await import('../src/filterhunt.js');
  const done = (verdict, n, bestPnl, extra) => ({ status: 'done', verdict, n, bestPnl, ...extra });
  const rows = rankRows([
    { mint: 'Beg', creator: 'DevBeg', analysis: done('track', 10, 0.37, { teamKeys: ['trk:Last'], members: ['DevBeg', 'Dev2', 'Last'] }) },
    { mint: 'Ctrl', creator: 'Last', analysis: done('track', 8, 0.40, { teamKeys: ['trk:Last'], members: ['Last'] }) },
    { mint: 'Chain', creator: 'Dev2', analysis: done('late', 3, 0.1, { teamKeys: [], members: ['Dev2'] }) },
    { mint: 'Solo', creator: 'Autre', analysis: done('track', 7, 0.29, { teamKeys: ['trk:X'], members: ['Autre'] }) },
    { mint: 'Wait', creator: 'W', analysis: { status: 'waiting' } },
  ]);
  groupTeams(rows);
  const leads = rows.filter((r) => !r.teamLead).map((r) => r.mint);
  assert.deepEqual(leads, ['Ctrl', 'Solo', 'Wait']);
  assert.deepEqual(rows.find((r) => r.mint === 'Ctrl').team.map((t) => t.mint).sort(), ['Beg', 'Chain']);
});

test('cerveau F Project : un exchange sans nom n’est pas un tracker tant qu’il n’est pas confirmé', async () => {
  const { adviseBot } = await import('../src/advice.js');
  const census = { kind: 'exchange', source: 'HotX', label: 'Exchange sans nom', devs: [{ address: 'D1' }, { address: 'D2' }, { address: 'D3' }], ranges: [{ min: 1.9939, max: 1.9941, amount: 1.994, n: 3 }], freshShare: 1 };
  const a = adviseBot({ start: 'D1', base: { verdict: 'dig' }, fwd: { nodes: [] }, after: [], startTokens: 1, census, now: 100 });
  assert.equal(a.verdict, 'dig'); assert.match(a.warning, /Solscan/);
  const named = adviseBot({ start: 'D1', base: { verdict: 'dig' }, fwd: { nodes: [] }, after: [], startTokens: 1, census: { ...census, label: 'Binance' }, now: 100 });
  assert.equal(named.verdict, 'track');
  const b = adviseBot({ start: 'D1', base: { verdict: 'track', kind: 'cex', name: 'Exchange sans nom', address: 'HotX', minSol: 1.9939, maxSol: 1.9941 }, fwd: { nodes: [] }, after: [], startTokens: 1, now: 100 });
  assert.equal(b.verdict, 'dig');
});

test('schéma araignée : la mère découpe 1 SOL en 10 wallets neufs qui renvoient tout au dev', async () => {
  const { detectSpider, legGroup } = await import('../src/spider.js');
  const { adviseBot } = await import('../src/advice.js');
  const { devSource } = await import('../src/devsource.js');
  const txs = {}; const sigsOf = { Dev: [] };
  for (let i = 0; i < 10; i++) {
    const leg = `Patte${i}`;
    txs[`m${i}`] = send(`m${i}`, 1000 + i, 'Mere', leg, 0.1005);
    txs[`l${i}`] = send(`l${i}`, 1060 + i * 5, leg, 'Dev', 0.1);
    sigsOf[leg] = [`l${i}`, `m${i}`];
    sigsOf.Dev.push(`l${i}`);
  }
  txs.create = { ...pump('create', 1200, 'Dev', 'MintAraignee', 800e6, -0.9), create: mint('MintAraignee', 'araignee') };
  // la mère est un wallet réutilisé (30 transactions plus anciennes)
  sigsOf.Mere = [...Array.from({ length: 30 }, (_, i) => { txs[`old${i}`] = send(`old${i}`, 100 + i, 'Src', 'Mere', 0.2); return `old${i}`; }), ...Array.from({ length: 10 }, (_, i) => `m${i}`)];
  sigsOf.Dev.push('create');
  const rpc = {
    async sigsPage(a) { return (sigsOf[a] || []).map((s) => ({ signature: s, blockTime: txs[s].time, err: null })).sort((x, y) => y.blockTime - x.blockTime); },
    async tx(s) { return txs[s]; },
    async balances() { return {}; },
  };
  const sp = await detectSpider(rpc, 'Dev', 1200);
  assert.equal(sp.mother, 'Mere'); assert.equal(sp.legs.length, 10);
  assert.ok(Math.abs(sp.total - 1) < 1e-6);
  assert.ok(sp.ranges[0][0] <= 0.1005 && sp.ranges[0][1] >= 0.1005);
  const a = adviseBot({ start: 'Dev', base: { verdict: 'dig' }, spider: sp, fwd: { nodes: [] }, after: [], startTokens: 1, now: 2000 });
  assert.equal(a.verdict, 'track'); assert.equal(a.address, 'Mere'); assert.equal(a.mode, 'exchange');
  assert.ok(a.options.some((o) => o.key === 'spiderScheme' && o.on));
  const src = await devSource(rpc, 'Dev', 1200);
  assert.equal(src.kind, 'spider'); assert.equal(src.color, 'green');
  // pas d'araignée : montants très différents venant de wallets sans lien
  assert.equal(legGroup([{ from: 'A', sol: 0.1, at: 1 }, { from: 'B', sol: 2, at: 2 }, { from: 'C', sol: 0.5, at: 3 }]).length, 0);
});

test('dev financé par Binance, montant pas encore répété : on surveille Binance, jamais le dev en Dernier Transfert', async () => {
  const { adviseBot } = await import('../src/advice.js');
  const base = { verdict: 'dig', kind: 'cex', name: 'Binance', address: '8DfHuYFv7VQ6wgcGtVDN2vtFn5ezF52hHNtPWYcqm8hU', minSol: 8.4619, maxSol: 8.4621 };
  const flow = { end: 'rest', frontier: { address: 'Dev', balanceSol: 10.86 }, path: [{ address: 'Dev' }], creates: [] };
  const a = adviseBot({ start: 'Dev', base, fwd: { nodes: [] }, after: [], startTokens: 1, startBalanceSol: 10.86, flow, now: 100 });
  assert.equal(a.verdict, 'wait'); assert.equal(a.watch.address, base.address);
  assert.notEqual(a.mode, 'last');
  // mais si l'argent est déjà passé à un nouveau dev qui lance, on suit la chaîne
  const chain = { end: 'launched', frontier: { address: 'Dev2', balanceSol: 0.1, creates: [{ mint: 'M2', creator: 'Dev2' }] }, path: [{ address: 'Dev' }, { address: 'Dev2' }], creates: [{ mint: 'M2', symbol: 'M2', creator: 'Dev2' }] };
  const b = adviseBot({ start: 'Dev', base, fwd: { nodes: [] }, after: [], startTokens: 1, startBalanceSol: 0, flow: chain, now: 100 });
  assert.equal(b.verdict, 'track'); assert.equal(b.address, 'Dev2');
});

test('schéma exchange : tous les retraits du dev, 72 h d\'envois et les autres hot wallets du même exchange', async () => {
  const BA = '8DfHuYFv7VQ6wgcGtVDN2vtFn5ezF52hHNtPWYcqm8hU', BB = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
  const T0 = 1_000_000, H = 3600;
  const list = [
    send('e1', T0, BA, 'ExDev', 8.462), // gros retrait : ne se répète pas
    send('e2', T0 + 10, BA, 'ExDev', 1.4216), // petit retrait : c'est lui qu'il répète
    pump('e3', T0 + 100, 'ExDev', 'MintEx1', 1000, -1, mint('MintEx1', 'exun')),
    send('e4', T0 - 50 * H, BA, 'Ex3', 1.42165), // il y a 50 h : vu seulement en lisant 72 h
    pump('e5', T0 - 50 * H + 60, 'Ex3', 'MintEx3', 1000, -1, mint('MintEx3', 'extrois')),
    send('e6', T0 + H, BB, 'Ex2', 1.42155), // autre hot wallet Binance
    pump('e7', T0 + H + 60, 'Ex2', 'MintEx2', 1000, -1, mint('MintEx2', 'exdeux')),
    send('e8', T0 + 2 * H, BA, 'Client', 3.7), // envoi courant d'un autre client
  ];
  const by = Object.fromEntries(list.map((t) => [t.sig, t]));
  const hist = {};
  for (const t of [...list].sort((a, b) => b.time - a.time)) for (const a of new Set([...t.signers, ...t.transfers.flatMap((x) => [x.from, x.to])])) (hist[a] ||= []).push(t.sig);
  const rpcX = {
    async sigsPage(a) { return (hist[a] || []).map((s) => ({ signature: s, blockTime: by[s].time, err: null })); },
    async tx(s) { return by[s]; },
    async balances(l) { return Object.fromEntries(l.map((a) => [a, 0.001 * SOL])); },
    async windowTxs(a, from, to, cap, order = 'asc') {
      const out = (hist[a] || []).map((s) => by[s]).filter((t) => t.time >= from && t.time <= to);
      if (order === 'asc') out.reverse();
      return { txs: out.slice(0, cap), capped: out.length > cap };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  let res;
  try { res = await trace('ExDev', rpcX, { ...PRESETS.normal, now: T0 + 3 * H }); } finally { globalThis.fetch = realFetch; }
  const small = res.fingerprints.find((f) => Math.abs(f.sol - 1.4216) < 0.0002);
  assert.ok(small, 'le petit retrait est cherché aussi');
  assert.equal(small.windowHours, 72);
  assert.equal(small.creators, 2);
  assert.deepEqual(small.bySource.map((b) => [b.address, b.creators]).filter((x) => x[1]), [[BA, 1], [BB, 1]]);
  assert.equal(res.tracker.verdict, 'track');
  assert.equal(res.tracker.address, BA);
  assert.deepEqual(res.tracker.alsoTrack, [BB]);
  assert.equal(res.tracker.minSol, 1.4215);
});

test('chasse : à niveau égal, un dev financé par un exchange passe devant', async () => {
  const { rankRows } = await import('../src/filterhunt.js');
  const row = (ca, exchange, bestPnl = 1) => ({ ca, analysis: { status: 'done', verdict: 'track', n: 6, bestPnl, exchange } });
  const out = rankRows([row('mere', false, 3), row('binance', true, 1), row('perdant', true, -1)]);
  assert.deepEqual(out.map((r) => r.ca), ['binance', 'mere', 'perdant']);
});
