// Test du registre : (1) sur de vraies transactions Jupiter avec un virement (comme une fee de terminal),
// (2) sur un versement de cashback simulé (mémo + virements).
import { PublicKey } from "@solana/web3.js";
import { feesIn, JUPITER, payoutsOut } from "@/lib/server/ledger";
import { rpc } from "@/lib/server/rpc";

const conn = rpc();
const sigs = await conn.getSignaturesForAddress(new PublicKey(JUPITER), { limit: 40 });
let found = 0;
for (const s of sigs) {
  if (s.err || found >= 2) continue;
  const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 1 as 0 });
  await new Promise((r) => setTimeout(r, 400));
  if (!tx) continue;
  const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
  for (const ix of tx.transaction.message.instructions as any[]) {
    if (ix.program === "system" && ix.parsed?.type === "transfer" && ix.parsed.info.source === signer && ix.parsed.info.destination !== signer) {
      const dest = ix.parsed.info.destination;
      const got = feesIn(tx, dest);
      console.log(`tx ${s.signature.slice(0, 10)}… virement ${signer?.slice(0, 6)} → ${dest.slice(0, 6)} ${ix.parsed.info.lamports} lamports | lu par le registre :`, got.map((g) => `${g.from.slice(0, 6)} ${g.lamports}`));
      console.log(`   même tx avec un autre wallet de fees :`, feesIn(tx, "11111111111111111111111111111112").length, "(attendu 0)");
      found++;
      break;
    }
  }
}
if (!found) console.log("Aucune tx Jupiter avec virement direct dans cet échantillon (relancer).");

// Versement simulé
const cb = "CashbackWa11et111111111111111111111111111111";
const mk = (memo: boolean, err: unknown = null) => ({
  meta: { err },
  transaction: {
    message: {
      accountKeys: [],
      instructions: [
        ...(memo ? [{ program: "spl-memo", parsed: "vigil-cashback" }] : []),
        { program: "system", parsed: { type: "transfer", info: { source: cb, destination: "TraderA", lamports: 625000 } } },
        { program: "system", parsed: { type: "transfer", info: { source: cb, destination: "TraderB", lamports: 1250000 } } },
      ],
    },
  },
});
console.log("versement avec mémo :", payoutsOut(mk(true) as any, cb).map((p) => `${p.to} ${p.lamports}`), "(attendu TraderA 625000, TraderB 1250000)");
console.log("virement sans mémo :", payoutsOut(mk(false) as any, cb).length, "(attendu 0)");
console.log("tx échouée :", payoutsOut(mk(true, { x: 1 }) as any, cb).length, "(attendu 0)");
