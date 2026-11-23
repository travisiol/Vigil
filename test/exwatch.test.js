// Surveillance exchange, sans réseau : un wallet neuf reçoit le montant exact du rugger, puis lance un token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExchangeWatch, watchFromInvestigation, hotWalletsOf } from '../src/exwatch.js';

const SOL = 1e9;
const BA = '8DfHuYFv7VQ6wgcGtVDN2vtFn5ezF52hHNtPWYcqm8hU';
const send = (sig, time, from, to, sol) => ({ sig, time, feePayer: from, signers: [from], transfers: [{ from, to, lamports: Math.round(sol * SOL) }], create: null });
const create = (sig, time, who, mint) => ({ sig, time, feePayer: who, signers: [who], transfers: [], create: { mint, symbol: 'NEUF', name: 'neuf' } });

const inv = {
  id: 'AZDz-x', start: 'DevAncien',
  fingerprints: [
    { source: BA, name: 'Binance', kind: 'exchange', sol: 8.46195 },
    { source: BA, name: 'Binance', kind: 'exchange', sol: 1.42165 },
  ],
  tokens: [{ creator: 'DevAncien', symbol: 'VIEUX', mint: 'MintVieux' }],
  advice: { verdict: 'wait', watch: { address: BA } },
};

test('surveillance exchange : la fiche du rugger reprend ses montants et tous les hot wallets de son exchange', () => {
  const w = watchFromInvestigation(inv, 1000);
  assert.deepEqual(w.amounts, [8.46195, 1.42165]);
  assert.ok(w.addresses.includes(BA));
  assert.ok(w.addresses.length >= 3, 'les autres hot wallets Binance sont lus aussi');
  assert.ok(!w.addresses.includes('GBrURzmtWujJRTA3Bkvo7ZgWuZYLMMwPCwre7BejJXnK'), 'pas le cold wallet');
  assert.deepEqual(hotWalletsOf('Exchange sans nom'), []);
  assert.equal(watchFromInvestigation({ ...inv, fingerprints: [] }), null);
});

test('surveillance exchange : un wallet neuf reçoit le montant exact puis lance → schéma confirmé', async () => {
  const now = 10_000;
  const txs = {
    [BA]: [send('b1', now - 100, BA, 'Neuf', 1.42168), send('b2', now - 90, BA, 'Client', 1.4300), send('b3', now - 80, BA, 'DevAncien', 1.4217)],
    Neuf: [create('n2', now - 40, 'Neuf', 'MintNeuf'), send('b1', now - 100, BA, 'Neuf', 1.42168)],
  };
  const by = Object.fromEntries(Object.values(txs).flat().map((t) => [t.sig, t]));
  const rpc = {
    async windowTxs(a, from, to) { return { txs: (txs[a] || []).filter((t) => t.time >= from && t.time <= to), capped: false }; },
    async sigsPage(a) { return (txs[a] || []).map((t) => ({ signature: t.sig, blockTime: t.time, err: null })); },
    async tx(s) { return by[s]; },
  };
  const ew = new ExchangeWatch({ file: null, rpc: () => rpc });
  ew.addFromInvestigation(inv, now - 1000);
  await ew.tick(now);
  const w = ew.state.watches[0];
  assert.equal(w.hits.length, 1, 'seul le montant exact compte, pas 1,43 ni le dev déjà connu');
  const h = w.hits[0];
  assert.equal(h.to, 'Neuf');
  assert.equal(h.status, 'created');
  assert.equal(h.mint, 'MintNeuf');
  assert.equal(w.confirmed, true);
  // retiré à la main : pas remis au redémarrage
  ew.remove(w.id);
  assert.equal(ew.addFromInvestigation(inv, now, { backfill: true }), null);
  assert.ok(ew.addFromInvestigation(inv, now));
});
