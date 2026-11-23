import { Cache } from './src/cache.js';
import { Rpc, rpcConfigFromEnv } from './src/rpc.js';
const rpc = new Rpc({ ...rpcConfigFromEnv(), cache: new Cache('data') });
const MINT_AUTH = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
const now = Math.floor(Date.now() / 1000);
try {
  const res = await rpc.call('getTransactionsForAddress', [MINT_AUTH, { transactionDetails: 'full', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, sortOrder: 'desc', limit: 100, filters: { blockTime: { gte: now - 600, lte: now }, status: 'succeeded' } }]);
  console.log('ok', res?.data?.length);
} catch (e) { console.log('ERR', String(e.message).slice(0, 300)); }
const t1 = Date.now();
const s = await rpc.sigsPage(MINT_AUTH, undefined, 200);
const txs = await Promise.all(s.slice(0, 200).map((x) => rpc.tx(x.signature).catch(() => null)));
console.log('200 tx un par un :', txs.filter((t) => t?.create).length, 'créations en', Date.now() - t1, 'ms', 'rps', rpc.rps ?? '');
