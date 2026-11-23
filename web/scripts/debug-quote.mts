// Debug : où la bonding curve pump.fun range-t-elle sa monnaie de cotation ?
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { rpc } from "@/lib/server/rpc";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
for (const mint of process.argv.slice(2)) {
  const pda = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0];
  const info = await rpc().getAccountInfo(pda);
  if (!info) { console.log(mint, "no curve"); continue; }
  const d = info.data;
  console.log(`\n${mint.slice(0, 8)} len ${d.length} complete ${d[48]}`);
  for (let o = 49; o + 32 <= d.length; o += 1) {
    if (o === 49 || o === 81 || o === 82 || o === 83 || o === 113 || o === 114 || o === 115 || o === 129 || o === 130 || o === 131) console.log("  @" + o, bs58.encode(d.subarray(o, o + 32)), "byte", d[o]);
  }
  console.log("  tail bytes", [...d.subarray(81, 90)]);
}
