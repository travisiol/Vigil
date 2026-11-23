// Contrôle : construit un achat et un vente (sans signer ni envoyer) et affiche le contenu de la transaction.
import { ComputeBudgetProgram, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { rpc } from "@/lib/server/rpc";
import { buildSwap } from "@/lib/server/swap";

const conn = rpc();
// La simulation réelle échouerait (wallet de test vide) : on la remplace pour voir la transaction.
(conn as any).simulateTransaction = async () => ({ value: { err: null, logs: [], unitsConsumed: 150_000 } });

const taker = "3nrNqWgFEwSJ1pufuk6Q4Rz158H8sTgBHiej9rTCijfJ";
const mint = process.argv[2];
for (const side of ["buy", "sell"] as const) {
  const q = await buildSwap({ side, mint, amount: side === "buy" ? "100000000" : "1000000000", taker, slippageBps: 1000 });
  const tx = VersionedTransaction.deserialize(Buffer.from(q.tx, "base64"));
  const keys = tx.message.staticAccountKeys;
  console.log(`\n${side.toUpperCase()} in=${q.inAmount} out=${q.outAmount} min=${q.minOut} fee=${q.feeLamports} lamports size=${tx.serialize().length}B`);
  tx.message.compiledInstructions.forEach((ix, i) => {
    const prog = keys[ix.programIdIndex]?.toBase58() ?? "(alt)";
    let label = prog.slice(0, 8);
    if (prog === SystemProgram.programId.toBase58()) {
      const d = Buffer.from(ix.data);
      if (d.readUInt32LE(0) === 2) label = `SYSTEM transfer ${d.readBigUInt64LE(4)} lamports -> ${keys[ix.accountKeyIndexes[1]]?.toBase58().slice(0, 6)}`;
    }
    if (prog === ComputeBudgetProgram.programId.toBase58()) label = `COMPUTE ${ix.data[0] === 2 ? "limit" : "price"}`;
    console.log(`  ${i}. ${label}`);
  });
}
