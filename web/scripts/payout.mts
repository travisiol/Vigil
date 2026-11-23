/**
 * Versement quotidien du cashback Vigil (FEES.md §6).
 *
 * À BLANC par défaut : calcule ce que chaque trader doit recevoir et l'affiche, sans rien envoyer.
 *   npx tsx --conditions=react-server scripts/payout.mts
 * Pour verser pour de vrai (c'est toi qui le lances, jamais automatique sans ton accord) :
 *   npx tsx --conditions=react-server scripts/payout.mts --send --keypair C:\chemin\cashback.json
 *
 * La clé du wallet de cashback reste dans un fichier à toi, hors du projet (créé avec `solana-keygen new -o cashback.json`).
 * Elle n'est jamais dans .env.local ni dans le serveur web. Ce wallet ne contient que la part cashback (25 %),
 * envoyée depuis le multisig de fees.
 */
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { brand } from "@/brand.config";
import { cashbackOf, PAYOUT_MEMO, syncLedger } from "@/lib/server/ledger";
import { rpc } from "@/lib/server/rpc";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const PER_TX = 18; // virements par transaction
const RENT_MIN = 890_880n; // un wallet vide doit recevoir au moins ça

const args = process.argv.slice(2);
const send = args.includes("--send");
const keyPath = args[args.indexOf("--keypair") + 1];

const cashbackWallet = process.env.VIGIL_CASHBACK_WALLET;
if (!process.env.VIGIL_FEE_WALLET || !cashbackWallet) {
  console.error("VIGIL_FEE_WALLET et VIGIL_CASHBACK_WALLET doivent être définis (adresses publiques).");
  process.exit(1);
}

const conn = rpc();
const ledger = await syncLedger(true);
if (!ledger) process.exit(1);

const min = BigInt(Math.round(brand.fees.cashbackMinSol * 1e9));
const due: { wallet: string; lamports: bigint }[] = [];
for (const [wallet, row] of Object.entries(ledger.wallets)) {
  const { owed } = cashbackOf(row);
  if (owed >= min) due.push({ wallet, lamports: owed });
}
due.sort((a, b) => (b.lamports > a.lamports ? 1 : -1));

// Les wallets vides ne peuvent pas recevoir moins que le minimum de rente : on les reporte.
const balances = due.length ? await conn.getMultipleAccountsInfo(due.map((d) => new PublicKey(d.wallet))) : [];
const payable = due.filter((d, i) => balances[i] || d.lamports >= RENT_MIN);
const total = payable.reduce((s, d) => s + d.lamports, 0n);

console.log(`\nCashback Vigil — ${new Date().toISOString()}`);
console.log(`Traders à payer : ${payable.length} · total ${(Number(total) / 1e9).toFixed(6)} SOL (reportés : ${due.length - payable.length})`);
for (const d of payable.slice(0, 50)) console.log(`  ${d.wallet}  ${(Number(d.lamports) / 1e9).toFixed(6)} SOL`);
if (payable.length > 50) console.log(`  … et ${payable.length - 50} autres`);

const balance = BigInt(await conn.getBalance(new PublicKey(cashbackWallet)));
const fees = BigInt(Math.ceil(payable.length / PER_TX)) * 5000n;
console.log(`Solde du wallet de cashback : ${(Number(balance) / 1e9).toFixed(6)} SOL (besoin : ${(Number(total + fees) / 1e9).toFixed(6)} SOL)`);

if (!send) {
  console.log("\nÀ blanc : rien n'a été envoyé. Ajoute --send --keypair <fichier> pour verser.");
  process.exit(0);
}
if (!keyPath || keyPath.startsWith("--")) {
  console.error("--keypair <fichier> manquant.");
  process.exit(1);
}
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
if (payer.publicKey.toBase58() !== cashbackWallet) {
  console.error("La clé ne correspond pas à VIGIL_CASHBACK_WALLET.");
  process.exit(1);
}
if (balance < total + fees) {
  console.error("Solde insuffisant : envoie d'abord la part cashback depuis le multisig.");
  process.exit(1);
}

for (let i = 0; i < payable.length; i += PER_TX) {
  const chunk = payable.slice(i, i + PER_TX);
  const tx = new Transaction();
  tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(PAYOUT_MEMO) }));
  for (const d of chunk) tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(d.wallet), lamports: d.lamports }));
  const sig = await conn.sendTransaction(tx, [payer]);
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`  versé à ${chunk.length} traders · https://solscan.io/tx/${sig}`);
}
await syncLedger(true);
console.log("Terminé. Le registre est à jour.");
