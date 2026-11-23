import { Cache } from './src/cache.js';
import { Rpc, rpcConfigFromEnv } from './src/rpc.js';
import { filterHunt } from './src/filterhunt.js';
import { createsOf } from './src/hunt.js';
const rpc = new Rpc({ ...rpcConfigFromEnv(), cache: new Cache('data') });
const t0 = Date.now();
const r = await filterHunt(rpc, { hours: 3, minVolume: 15000, maxEntryUsd: 10000, minPeakPct: 100, minRugDrop: 70, rugWithinSec: 60, singleDev: true, max: 10 }, (e) => { if (e.type === 'log' && !/^Marché|^Créations lues/.test(e.msg)) console.log(Math.round((Date.now() - t0) / 1000) + ' s ·', e.msg); }, { solUsd: 73.6, createsOf });
console.log('stats', JSON.stringify(r.stats));
for (const x of r.rows) console.log(x.symbol, '| 1re bougie', Math.round(x.entryUsd), '$ | +', Math.round(x.peakPct), '% | plus haut', Math.round(x.athUsd), '$ | rug −', Math.round(x.rugDropPct), '% à', x.rugAfterSec, 's | bundle', x.bundle, (x.bundlePct ?? 0).toFixed(1) + '% | dev', x.creator.slice(0, 6), 'tokens', x.devTokens);
