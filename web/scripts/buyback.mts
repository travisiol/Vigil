/**
 * Rachat de $VIGIL avec les fees (FEES.md : 50 % des fees, dont la moitié des tokens rachetés est brûlée).
 *
 * À BLANC par défaut : calcule ce qui est dû et l'affiche, sans rien envoyer.
 *   npx tsx --conditions=react-server scripts/buyback.mts
 * Pour racheter pour de vrai (c'est toi qui le lances, jamais automatique sans ton accord) :
 *   npx tsx --conditions=react-server scripts/buyback.mts --send --keypair C:\chemin\buyback.json
 *
 * Prêt à l'avance : tant que VIGIL_TOKEN_MINT (le CA de $VIGIL) est vide, le script dit seulement combien est mis de côté.
 * Le jour du lancement, il suffit de remplir VIGIL_TOKEN_MINT et VIGIL_BUYBACK_WALLET dans .env.local.
 *
 * Preuve publique : chaque rachat porte le mémo "vigil-buyback", chaque burn le mémo "vigil-burn".
 * La page /verify relit tout sur la blockchain : SOL dépensés, $VIGIL rachetés, brûlés, restants.
 *
 * Calcul :
 *   dû = 50 % de toutes les fees Vigil reçues (registre relu sur la blockchain) − SOL déjà dépensés en rachats (mémos vigil-buyback)
 *   rachat de ce run = min(dû, solde du wallet de rachat − 0,01 SOL de réserve pour les frais)
 *   puis brûle 50 % des $VIGIL obtenus par ce rachat. L'autre moitié reste dans le wallet de rachat, visible de tous.
 */
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { brand } from "@/brand.config";
import { BURN_MEMO, BUYBACK_MEMO, buybacks } from "@/lib/server/buybacks";
import { syncLedger, totals } from "@/lib/server/ledger";
import { rpc } from "@/lib/server/rpc";
import { compileTx, jupiterRoute } from "@/lib/server/swap";

const SOL = "So11111111111111111111111111111111111111112";
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const RESERVE = 10_000_000n; // 0,01 SOL gardés pour les frais réseau
const MIN_BUY = 5_000_000n; // pas de rachat sous 0,005 SOL (les frais mangeraient tout)
const SLIPPAGE_BPS = 300;

const args = process.argv.slice(2);
const send = args.includes("--send");
const keyPath = args[args.indexOf("--keypair") + 1];
const memo = (text: string) => new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(text) });

const mintStr = process.env.VIGIL_TOKEN_MINT || "";
const walletStr = process.env.VIGIL_BUYBACK_WALLET || "";
const share = brand.fees.split.find((s) => /buyback/i.test(s.label))?.pct ?? 50;

async function main(): Promise<number> {
  const ledger = await syncLedger(true);
  if (!ledger) {
    console.error("Registre des fees illisible (VIGIL_FEE_WALLET défini ?).");
    return 1;
  }
  const fees = totals(ledger).fees; // lamports de fees Vigil reçues
  const target = (fees * BigInt(share)) / 100n;
  console.log(`\nRachat $VIGIL — ${new Date().toISOString()}`);
  console.log(`Fees Vigil reçues : ${(Number(fees) / 1e9).toFixed(6)} SOL · part rachat (${share} %) : ${(Number(target) / 1e9).toFixed(6)} SOL`);

  if (!mintStr || !walletStr) {
    console.log("\n$VIGIL n'est pas encore lancé (VIGIL_TOKEN_MINT ou VIGIL_BUYBACK_WALLET vide).");
    console.log(`Mis de côté pour le premier rachat : ${(Number(target) / 1e9).toFixed(6)} SOL. Rien n'a été envoyé.`);
    return 0;
  }

  const conn = rpc();
  const mint = new PublicKey(mintStr);
  const wallet = new PublicKey(walletStr);
  const done = await buybacks();
  const spent = BigInt(Math.round(done.solSpent * 1e9));
  const due = target > spent ? target - spent : 0n;
  const balance = BigInt(await conn.getBalance(wallet));
  const available = balance > RESERVE ? balance - RESERVE : 0n;
  const amount = due < available ? due : available;
  console.log(`Déjà racheté : ${done.solSpent.toFixed(6)} SOL → ${done.bought.toLocaleString("en-US")} $VIGIL (${done.burned.toLocaleString("en-US")} brûlés)`);
  console.log(`Dû maintenant : ${(Number(due) / 1e9).toFixed(6)} SOL · solde du wallet de rachat : ${(Number(balance) / 1e9).toFixed(6)} SOL`);
  if (amount < MIN_BUY) {
    console.log(due > available ? "\nSolde insuffisant : envoie d'abord la part rachat depuis le wallet de fees." : "\nRien à racheter pour l'instant.");
    return 0;
  }
  console.log(`Ce run rachète pour ${(Number(amount) / 1e9).toFixed(6)} SOL, puis brûle la moitié des $VIGIL obtenus.`);
  if (!send) {
    console.log("\nÀ blanc : rien n'a été envoyé. Ajoute --send --keypair <fichier> pour racheter.");
    return 0;
  }
  if (!keyPath || keyPath.startsWith("--")) {
    console.error("--keypair <fichier> manquant.");
    return 1;
  }
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
  if (!payer.publicKey.equals(wallet)) {
    console.error("La clé ne correspond pas à VIGIL_BUYBACK_WALLET.");
    return 1;
  }

  // Solde $VIGIL avant / après, sur le compte de token du wallet de rachat
  const mintInfo = await conn.getParsedAccountInfo(mint);
  const tokenProgram = mintInfo.value!.owner;
  const decimals = (mintInfo.value!.data as { parsed: { info: { decimals: number } } }).parsed.info.decimals;
  const ata = PublicKey.findProgramAddressSync([wallet.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
  const balanceOf = async () => BigInt((await conn.getTokenAccountBalance(ata).catch(() => null))?.value.amount ?? "0");
  const before = await balanceOf();

  // 1) Rachat au marché, même route Jupiter que les trades Vigil, avec le mémo de preuve
  const route = await jupiterRoute({ inputMint: SOL, outputMint: mintStr, amount, taker: walletStr, slippageBps: SLIPPAGE_BPS });
  const body = [...route.before, memo(BUYBACK_MEMO), route.swap, ...route.after];
  const sim = await conn.simulateTransaction(compileTx(wallet, route.recentBlockhash, body, route.alts, 1_400_000), { sigVerify: false, replaceRecentBlockhash: true });
  if (sim.value.err) {
    console.error("Le rachat échouerait :", JSON.stringify(sim.value.err));
    return 1;
  }
  const tx = compileTx(wallet, route.recentBlockhash, body, route.alts, Math.min(1_400_000, Math.ceil((sim.value.unitsConsumed ?? 300_000) * 1.2)));
  tx.sign([payer]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`Rachat fait · https://solscan.io/tx/${sig}`);

  // 2) Burn de la moitié des $VIGIL obtenus (BurnChecked, Token ou Token-2022)
  const got = (await balanceOf()) - before;
  const burn = got / 2n;
  if (burn > 0n) {
    const data = Buffer.alloc(10);
    data[0] = 15; // BurnChecked
    data.writeBigUInt64LE(burn, 1);
    data[9] = decimals;
    const burnIx = new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: wallet, isSigner: true, isWritable: false },
      ],
      data,
    });
    const { blockhash } = await conn.getLatestBlockhash();
    const btx = compileTx(wallet, blockhash, [memo(BURN_MEMO), burnIx], [], 60_000);
    btx.sign([payer]);
    const bsig = await conn.sendRawTransaction(btx.serialize(), { maxRetries: 3 });
    await conn.confirmTransaction(bsig, "confirmed");
    console.log(`Brûlé ${Number(burn) / 10 ** decimals} $VIGIL · https://solscan.io/tx/${bsig}`);
  }
  console.log("Terminé. La page /verify affichera ce rachat dans les 2 minutes.");
  return 0;
}

process.exitCode = await main();
