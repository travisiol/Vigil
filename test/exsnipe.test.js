// Snipe exchange, sans réseau : bundle à lui ou sniper, et verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeBundleWallet, exchangeVerdict, withdrawalsFrom, amountClusters } from '../src/exsnipe.js';

const SOL = 1e9;
const BIN = '8DfHuYFv7VQ6wgcGtVDN2vtFn5ezF52hHNtPWYcqm8hU';
const BIN2 = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const T = 1_000_000;
const send = (sig, time, from, to, sol) => ({ sig, time, feePayer: from, signers: [from], transfers: [{ from, to, lamports: Math.round(sol * SOL) }], tokenDelta: [], solDelta: {}, pump: false });
const trade = (sig, time, who, mint, delta) => ({ sig, time, feePayer: who, signers: [who], transfers: [], pump: true, solDelta: { [who]: delta > 0 ? -0.5 * SOL : 0.9 * SOL }, tokenDelta: [{ owner: who, mint, delta }, { owner: 'Curve', mint, delta: -delta }] });
const ctx = { dev: 'Dev', devFunder: BIN, exchange: 'Binance', createdAt: T, mint: 'Coin', devSellAt: T + 40, devDests: new Set(['DepotDev']) };

test('bundle : wallet neuf retiré de Binance juste avant, revend avec le rug, renvoie au même dépôt → à lui', () => {
  const txs = [send('a', T - 300, BIN, 'B1', 1.2345), trade('b', T, 'B1', 'Coin', 1000), trade('c', T + 41, 'B1', 'Coin', -1000), send('d', T + 60, 'B1', 'DepotDev', 1.1)];
  const r = judgeBundleWallet({ wallet: 'B1', rank: 1, delay: 0, bundle: true }, txs, false, ctx);
  assert.equal(r.verdict, 'mine');
  for (const k of ['fundExchange', 'fresh', 'rugSell', 'moneyBack']) assert.ok(r.signals.some((s) => s.key === k && s.ok), k);
});

test('bundle : vieux wallet qui achète des dizaines de tokens → sniper', () => {
  const txs = [send('f', T - 90000, 'Kucoin?', 'S1', 20)];
  for (let i = 0; i < 25; i++) txs.push(trade(`x${i}`, T - 5000 + i * 10, 'S1', `M${i}`, 100));
  txs.push(trade('y', T, 'S1', 'Coin', 100), trade('z', T + 600, 'S1', 'Coin', -100));
  const r = judgeBundleWallet({ wallet: 'S1', rank: 2, delay: 0, bundle: true }, txs, false, ctx);
  assert.equal(r.verdict, 'sniper');
  assert.ok(r.signals.some((s) => s.key === 'sniper'));
});

test('retraits : tous les retraits d’exchange du dev avant son lancement', () => {
  const txs = [send('1', T - 500, BIN, 'Dev', 8.462), send('2', T - 400, BIN, 'Dev', 1.4216), send('3', T - 300, 'Ami', 'Dev', 3), send('4', T + 10, BIN, 'Dev', 2)];
  assert.deepEqual(withdrawalsFrom(txs, 'Dev', T).map((w) => w.sol), [8.462, 1.4216]);
});

test('verdict : même montant chez deux devs → confirmé, Modèle d’Échange avec la plage exacte', () => {
  const fundings = [
    { dev: 'Dev', name: 'Binance', hot: BIN, sol: 1.4216, via: 'dev' },
    { dev: 'Dev2', name: 'Binance', hot: BIN2, sol: 1.42165, via: 'bundle' },
    { dev: 'Dev', name: 'Binance', hot: BIN, sol: 8.462, via: 'dev' },
  ];
  assert.equal(amountClusters(fundings)[0].devs.length, 2);
  const v = exchangeVerdict({ exchange: 'Binance', hot: BIN, fundings, mine: [], reused: [], bundleAmounts: [] });
  assert.equal(v.status, 'confirmed');
  assert.equal(v.bot.mode, "Modèle d'Échange");
  assert.deepEqual([v.bot.ranges[0].min, v.bot.ranges[0].max], [1.4215, 1.4217]);
  assert.ok(v.bot.options.some((o) => o.name === 'Hériter paramètres' && o.on));
});

test('verdict : montant qui change mais même wallet de bundle sur ses tokens → copytrade avec Achat unique', () => {
  const fundings = [{ dev: 'Dev', name: 'Binance', hot: BIN, sol: 2.1, via: 'dev' }, { dev: 'Dev2', name: 'Binance', hot: BIN, sol: 3.7, via: 'bundle' }];
  const v = exchangeVerdict({ exchange: 'Binance', hot: BIN, fundings, mine: [{ wallet: 'B1' }], reused: [{ wallet: 'B1', tokens: 3 }], bundleAmounts: [] });
  assert.equal(v.status, 'selfsnipe');
  assert.equal(v.bot.address, 'B1');
  assert.ok(v.bot.options.some((o) => o.name === 'Achat unique' && o.on));
  const w = exchangeVerdict({ exchange: 'Binance', hot: BIN, fundings, mine: [], reused: [], bundleAmounts: [] });
  assert.equal(w.status, 'variable');
  assert.equal(exchangeVerdict({ exchange: 'Binance', hot: BIN, fundings: fundings.slice(0, 1), mine: [], reused: [], bundleAmounts: [] }).status, 'watch');
});
