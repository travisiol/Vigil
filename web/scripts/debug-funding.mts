import { PublicKey } from "@solana/web3.js";
import { fundingOf } from "@/lib/server/funding";
import { rpc } from "@/lib/server/rpc";
const mint = process.argv[2];
const conn = rpc();
const sigs = (await conn.getSignaturesForAddress(new PublicKey(mint), { limit: 1000 })).reverse().filter((s) => !s.err).slice(0, 15);
const txs = await conn.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 1 as 0 });
const buyers: string[] = [];
for (const tx of txs) if (tx) { const fp = tx.transaction.message.accountKeys[0].pubkey.toBase58(); if (!buyers.includes(fp)) buyers.push(fp); }
console.log("first signers:", buyers.length, "slots:", [...new Set(txs.map((t) => t?.slot))].slice(0, 6));
const f = await fundingOf(buyers);
for (const b of buyers) { const x = f.get(b)!; console.log(b.slice(0, 6), "funder", x?.funder?.slice(0, 6) ?? "-", "aged", x?.aged, "hub", x?.hubFunder, "firstSeen", x?.firstSeen && Math.round((Date.now() / 1000 - x.firstSeen) / 60) + "min ago"); }
