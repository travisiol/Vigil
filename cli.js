// Usage : node cli.js <adresse> [rapide|normal|profond]
import { existsSync } from 'node:fs';
import { Cache } from './src/cache.js';
import { Rpc, rpcConfigFromEnv } from './src/rpc.js';
import { trace, PRESETS } from './src/tracer.js';
import { isAddress } from './src/parse.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const [address, preset = 'rapide'] = process.argv.slice(2);
if (!isAddress(address)) { console.error('Adresse Solana invalide.'); process.exit(1); }
const cfg = rpcConfigFromEnv();
const rpc = new Rpc({ ...cfg, cache: new Cache('data') });
const t0 = Date.now();
const res = await trace(address, rpc, PRESETS[preset] || PRESETS.rapide, (e) => { if (e.type === 'log') console.log('·', e.msg); });
console.log(JSON.stringify({ terminal: res.terminal, root: res.root, mother: res.mother, chain: res.chain, stats: res.stats, seconds: Math.round((Date.now() - t0) / 1000) }, null, 2));
console.table(res.tokens.map((t) => ({ ca: t.mint, symbol: t.symbol, côté: t.side, status: t.status, gainDev: t.pnlSol.toFixed(2), mcap: t.market?.marketCap ?? null })));
const MODE = { last: 'Dernier Transfert', exchange: "Modèle d'Échange", hybrid: 'Hybride' };
const a = res.advice || {};
console.log(`
Schéma : ${res.pattern.title}`);
if (res.census) console.log(`Source de ses devs : ${res.census.label || res.census.source} (${res.census.kind}), ${res.census.devs.length} devs, plages ${res.census.ranges.map((r) => `${r.min}-${r.max}`).join(' / ') || 'aucune'}`);
console.log(`Conseil F Project : ${a.verdict}${a.address ? ` · ${a.address}` : ''}${a.mode ? ` · ${MODE[a.mode]}` : ''}`);
if (a.ranges) console.log(`Plages : ${(Array.isArray(a.ranges[0]) ? a.ranges : [a.ranges]).map((r) => `${r[0]}-${r[1]}`).join(' / ')}`);
for (const o of a.options || []) if (typeof o === 'object') console.log(`  ${o.on ? '✓' : '✗'} ${o.key}${o.hours ? ` (${o.hours} h)` : ''} : ${o.why}`);
if (a.inactive) console.log(`INACTIF : ${a.inactiveReason}`);
console.log(`Pourquoi : ${a.reason}`);
if (a.tip) console.log(`Que faire : ${a.tip}`);
if (a.also) console.log(`2e tracker : ${a.also.address} · Modèle d'Échange · plage ${a.also.range[0]}-${a.also.range[1]} · Conserver l'adresse ON · Hériter paramètres OFF
  ${a.also.why}`);
console.log('');
console.table(res.cashouts.slice(0, 8).map((c) => ({ to: c.address.slice(0, 8), kind: c.kind, label: c.label, depositOf: c.depositOf, sol: c.sol.toFixed(2) })));
console.table(res.wallets.filter((w) => w.link).map((w) => ({ wallet: w.address.slice(0, 8), lien: w.link.type, via: w.link.via?.slice(0, 8), tokens: w.tokens, rugs: w.rugs })));
console.table(res.exchangeScan);
console.table(res.leads.map((l) => ({ wallet: l.address, type: l.type, sol: l.sol.toFixed(3), depot: l.depositSol.toFixed(3), delaiMin: Math.round(l.delaySeconds / 60), neuf: l.fresh, tokens: l.tokens, score: l.score })));
