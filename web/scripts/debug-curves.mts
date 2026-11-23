// Debug : lit les bonding curves des derniers lancements et affiche les champs bruts.
import { PublicKey } from "@solana/web3.js";
import { rpc } from "@/lib/server/rpc";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const conn = rpc();
const sigs = await conn.getSignaturesForAddress(new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"), { limit: 25 });
const txs = await conn.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 1 as 0 });
const mints: string[] = [];
for (const tx of txs) {
  if (!tx) continue;
  const signers = new Set(tx.transaction.message.accountKeys.slice(1).filter((k) => k.signer).map((k) => k.pubkey.toBase58()));
  const m = [...new Set((tx.meta?.postTokenBalances ?? []).map((b) => b.mint))].find((x) => signers.has(x));
  if (m) mints.push(m);
}
const pdas = mints.map((m) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(m).toBuffer()], PUMP)[0]);
const infos = await conn.getMultipleAccountsInfo(pdas);
infos.forEach((info, i) => {
  if (!info) return console.log(mints[i].slice(0, 8), "NO CURVE");
  const d = info.data;
  const f = (o: number) => d.readBigUInt64LE(o);
  const vTok = f(8), vSol = f(16), realTok = f(24), realSol = f(32), supply = f(40);
  const priceSol = Number(vSol) / 1e9 / (Number(vTok) / 1e6);
  console.log(mints[i].slice(0, 8), "len", d.length, "vTok", vTok, "vSol", vSol, "realTok", realTok, "realSol", realSol, "supply", supply, "complete", d[48], "mcapSOL", (priceSol * Number(supply) / 1e6).toFixed(2));
});
