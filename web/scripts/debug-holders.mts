// Debug : qui possède les plus gros comptes des derniers lancements pump.fun, et quel programme gère ces propriétaires.
import { PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { rpc } from "@/lib/server/rpc";

const conn = rpc();
const sigs = await conn.getSignaturesForAddress(new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"), { limit: 12 });
const txs = await conn.getParsedTransactions(sigs.slice(6, 10).map((s) => s.signature), { maxSupportedTransactionVersion: 1 as 0 });
for (const tx of txs) {
  if (!tx) continue;
  const mint = [...new Set((tx.meta?.postTokenBalances ?? []).map((b) => b.mint))].find((m) => m.endsWith("pump"));
  if (!mint) continue;
  const la = await conn.getTokenLargestAccounts(new PublicKey(mint));
  const supply = la.value.reduce((s, a) => s + (a.uiAmount ?? 0), 0);
  const accs = await conn.getMultipleParsedAccounts(la.value.slice(0, 3).map((a) => a.address));
  const owners = accs.value.map((a) => (a?.data as ParsedAccountData).parsed.info.owner as string);
  const oi = await conn.getMultipleAccountsInfo(owners.map((o) => new PublicKey(o)));
  console.log(`\n${mint}`);
  la.value.slice(0, 3).forEach((a, i) => console.log(`  ${((a.uiAmount ?? 0) / 1e9 * 100).toFixed(1)}% owner ${owners[i].slice(0, 8)} -> program ${oi[i]?.owner.toBase58().slice(0, 10) ?? "NO ACCOUNT"} lamports ${oi[i]?.lamports ?? 0}`));
}
