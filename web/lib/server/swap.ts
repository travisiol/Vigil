import "server-only";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { brand } from "@/brand.config";
import type { SwapQuote } from "../types";
import { curvePda, decodeCurve } from "./pump";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
import { cached, rpc, RPC_URL, UserError } from "./rpc";

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "https://api.jup.ag/swap/v2/build";

type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
type JupBuild = {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string | number;
  computeBudgetInstructions: JupIx[];
  setupInstructions: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction: JupIx | null;
  otherInstructions: JupIx[];
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: { blockhash: number[] | string; lastValidBlockHeight?: number };
};

const toIx = (i: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, "base64"),
  });

// Le budget de calcul vient de nous : la limite (mesurée par simulation) ET le prix (frais de priorité).
const isCuLimit = (i: JupIx) => i.programId === ComputeBudgetProgram.programId.toBase58() && Buffer.from(i.data, "base64")[0] === 2;
const isCuPrice = (i: JupIx) => i.programId === ComputeBudgetProgram.programId.toBase58() && Buffer.from(i.data, "base64")[0] === 3;

/**
 * Frais de priorité (F-072) : Jupiter mettait ~9 000 µlamports/CU, trop bas, donc les trades passaient après les autres (achat lent).
 * On demande à Helius le niveau "VeryHigh" du moment (gardé 10 s), avec un plancher et un plafond :
 * ~0,00013 à 0,00065 SOL par trade (≈ 1 à 5 centimes) selon l'encombrement du réseau, comme le mode "Fast" des terminaux.
 */
const PRIO_MIN = 1_000_000, PRIO_MAX = 5_000_000, PRIO_DEFAULT = 1_500_000; // ≈ 0,00013 à 0,00065 SOL pour ~130 k CU
function priorityMicroLamports(): Promise<number> {
  return cached("prio", 10_000, async () => {
    if (!RPC_URL.includes("helius")) return PRIO_DEFAULT;
    const r = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getPriorityFeeEstimate", params: [{ accountKeys: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"], options: { priorityLevel: "VeryHigh" } }] }),
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { result?: { priorityFeeEstimate?: number } } | null) : null;
    const v = j?.result?.priorityFeeEstimate;
    return typeof v === "number" && v > 0 ? Math.round(Math.min(PRIO_MAX, Math.max(PRIO_MIN, v))) : PRIO_DEFAULT;
  }).catch(() => PRIO_DEFAULT);
}

export type SwapInput = { side: "buy" | "sell"; mint: string; amount: string; taker: string; slippageBps: number };

/**
 * Route Jupiter (Swap V2, sans fee Jupiter) prête à assembler : instructions, tables d'adresses, blockhash.
 * Partagée par les trades des utilisateurs et par le rachat de $VIGIL (scripts/buyback.mts) : même route, même code.
 */
export async function jupiterRoute(p: { inputMint: string; outputMint: string; amount: bigint; taker: string; slippageBps: number }) {
  const q = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amount.toString(),
    taker: p.taker,
    slippageBps: String(Math.max(10, Math.min(5000, Math.round(p.slippageBps)))),
  });
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
  // Jupiter sans clé n'accepte que ~2 requêtes à la suite sur sa route principale (429) : un 2e essai, puis la route "lite" v1
  // (même programme Jupiter, donc les fees restent reconnues par le registre du cashback). Avec JUPITER_API_KEY, plus de limite.
  let b: JupBuild | null = null;
  for (let i = 0; i < 2 && !b; i++) {
    const r = await fetch(`${JUP}?${q}`, { headers, cache: "no-store" });
    if (r.ok) b = (await r.json()) as JupBuild;
    else {
      const text = await r.text();
      if (r.status !== 429) {
        if (/route/i.test(text)) throw new UserError("No route for this token right now.");
        throw new UserError(`Swap service error (${r.status}).`, 502);
      }
      if (i === 0) await new Promise((res) => setTimeout(res, 500));
    }
  }
  if (!b) b = await liteRoute(p);
  const prio = await priorityMicroLamports();
  const before = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prio }),
    ...b.computeBudgetInstructions.filter((i) => !isCuLimit(i) && !isCuPrice(i)).map(toIx),
    ...b.setupInstructions.map(toIx),
  ];
  const swap = toIx(b.swapInstruction);
  const after = [...(b.cleanupInstruction ? [toIx(b.cleanupInstruction)] : []), ...(b.otherInstructions ?? []).map(toIx)];
  const alts = Object.entries(b.addressesByLookupTableAddress ?? {}).map(
    ([key, addrs]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: { addresses: addrs.map((a) => new PublicKey(a)), deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0 },
      }),
  );
  const bh = b.blockhashWithMetadata.blockhash;
  const recentBlockhash = typeof bh === "string" ? bh : bs58.encode(Uint8Array.from(bh));
  return { b, before, swap, after, alts, recentBlockhash, lastValidBlockHeight: b.blockhashWithMetadata.lastValidBlockHeight ?? null, prio };
}

/** Route de secours : Jupiter v1 sans clé (devis + instructions), mise au même format que Swap V2. */
async function liteRoute(p: { inputMint: string; outputMint: string; amount: bigint; taker: string; slippageBps: number }): Promise<JupBuild> {
  const LITE = "https://lite-api.jup.ag/swap/v1";
  const qs = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString(), slippageBps: String(Math.max(10, Math.min(5000, Math.round(p.slippageBps)))) });
  const qr = await fetch(`${LITE}/quote?${qs}`, { cache: "no-store" });
  if (!qr.ok) {
    if (qr.status === 429) throw new UserError("The swap route service is busy. Try again in a few seconds.", 429);
    throw new UserError(/route/i.test(await qr.text()) ? "No route for this token right now." : `Swap service error (${qr.status}).`, 502);
  }
  const quote = (await qr.json()) as { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string };
  const ir = await fetch(`${LITE}/swap-instructions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: p.taker, wrapAndUnwrapSol: true }),
    cache: "no-store",
  });
  if (!ir.ok) throw new UserError(ir.status === 429 ? "The swap route service is busy. Try again in a few seconds." : `Swap service error (${ir.status}).`, ir.status === 429 ? 429 : 502);
  const j = (await ir.json()) as Omit<JupBuild, "inAmount" | "outAmount" | "otherAmountThreshold" | "priceImpactPct" | "addressesByLookupTableAddress"> & { addressLookupTableAddresses?: string[] };
  // Les tables d'adresses ne sont données que par leur adresse : on les lit sur la blockchain
  const conn = rpc();
  const tables: Record<string, string[]> = {};
  await Promise.all(
    (j.addressLookupTableAddresses ?? []).map(async (a) => {
      const t = await conn.getAddressLookupTable(new PublicKey(a)).catch(() => null);
      if (t?.value) tables[a] = t.value.state.addresses.map((x) => x.toBase58());
    }),
  );
  let bh = j.blockhashWithMetadata;
  if (!bh?.blockhash) {
    const l = await conn.getLatestBlockhash();
    bh = { blockhash: l.blockhash, lastValidBlockHeight: l.lastValidBlockHeight };
  }
  return { ...j, inAmount: quote.inAmount, outAmount: quote.outAmount, otherAmountThreshold: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct, addressesByLookupTableAddress: tables, blockhashWithMetadata: bh, otherInstructions: j.otherInstructions ?? [] };
}

/** Assemble une transaction v0 avec une limite de calcul. */
export function compileTx(payer: PublicKey, recentBlockhash: string, instructions: TransactionInstruction[], alts: AddressLookupTableAccount[], cu: number) {
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...instructions] }).compileToV0Message(alts),
  );
}

/**
 * Construit la transaction de trade (non signée) :
 * budget de calcul → setup → [fee si achat] → swap → cleanup → [fee si vente].
 * La fee part en SOL vers le wallet de fees (FEES.md). L'utilisateur signe dans son wallet.
 */
export async function buildSwap({ side, mint, amount, taker, slippageBps }: SwapInput): Promise<SwapQuote> {
  const feeWallet = process.env.VIGIL_FEE_WALLET;
  if (!feeWallet) throw new UserError("Trading opens soon: the fee wallet is not set yet.", 503);
  const feeTo = new PublicKey(feeWallet);
  const takerPk = new PublicKey(taker);
  const bps = BigInt(brand.fees.tradeFeeBps);

  const total = BigInt(amount);
  if (total <= 0n) throw new UserError("Enter an amount.");
  let feeLamports = side === "buy" ? (total * bps) / 10_000n : 0n;
  const swapAmount = side === "buy" ? total - feeLamports : total;

  const route = await jupiterRoute({ inputMint: side === "buy" ? SOL : mint, outputMint: side === "buy" ? mint : SOL, amount: swapAmount, taker, slippageBps });
  const b = route.b;

  if (side === "sell") feeLamports = (BigInt(b.otherAmountThreshold) * bps) / 10_000n;
  const feeIx = SystemProgram.transfer({ fromPubkey: takerPk, toPubkey: feeTo, lamports: feeLamports });

  const body: TransactionInstruction[] = [
    ...route.before,
    ...(side === "buy" && feeLamports > 0n ? [feeIx] : []),
    route.swap,
    ...route.after,
    ...(side === "sell" && feeLamports > 0n ? [feeIx] : []),
  ];
  const alts = route.alts;
  const recentBlockhash = route.recentBlockhash;
  const compile = (cu: number) => compileTx(takerPk, recentBlockhash, body, alts, cu);

  // Simulation (fixe la limite de calcul, attrape les erreurs avant la signature) et impact sur le prix : en parallèle
  const [sim, impact] = await Promise.all([
    rpc().simulateTransaction(compile(1_400_000), { sigVerify: false, replaceRecentBlockhash: true }),
    priceImpact(side, mint, swapAmount, b).catch(() => null),
  ]);
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).join("\n");
    const errStr = JSON.stringify(sim.value.err);
    if (/insufficient (lamports|funds)/i.test(logs) || /InsufficientFunds|AccountNotFound/.test(errStr)) throw new UserError(await notEnough(side, total, takerPk, mint));
    if (/slippage|0x1771/i.test(logs)) throw new UserError("Price moved too much. Raise slippage or try again.");
    throw new UserError("This trade would fail right now. Try a smaller amount.");
  }
  const units = Math.min(1_400_000, Math.ceil((sim.value.unitsConsumed ?? 300_000) * 1.2));
  const tx = compile(units);

  return {
    tx: Buffer.from(tx.serialize()).toString("base64"),
    side,
    inAmount: side === "buy" ? total.toString() : b.inAmount,
    outAmount: b.outAmount,
    minOut: b.otherAmountThreshold,
    feeLamports: feeLamports.toString(),
    priceImpactPct: impact,
    // Frais réseau : 5 000 lamports de base + priorité (prix par unité × unités de calcul)
    networkFeeLamports: String(5000 + Math.ceil((route.prio * units) / 1_000_000)),
    lastValidBlockHeight: b.blockhashWithMetadata.lastValidBlockHeight ?? null,
  };
}

/**
 * "Pas assez de SOL" avec le détail : un achat d'un token qu'on ne détient pas ouvre un compte de token (~0,00204 SOL,
 * rendus quand on le ferme), en plus des frais réseau. Sans ce détail, 0,003 SOL pour un achat de 0,001 SOL paraissait un bug.
 */
async function notEnough(side: "buy" | "sell", total: bigint, taker: PublicKey, mint: string): Promise<string> {
  const conn = rpc();
  const [lamports, accs] = await Promise.all([
    conn.getBalance(taker).catch(() => null),
    conn.getTokenAccountsByOwner(taker, { mint: new PublicKey(mint) }).catch(() => null),
  ]);
  const has = (lamports ?? 0) / 1e9;
  const rent = accs && accs.value.length === 0 && side === "buy" ? 0.00204 : 0;
  const network = 0.0007; // frais réseau + priorité (calibrée sur le réseau), au plus
  const trade = side === "buy" ? Number(total) / 1e9 : 0;
  const need = trade + rent + network;
  const parts = [side === "buy" ? `${trade} SOL for the trade` : null, rent ? "0.00204 SOL to open your token account (you get it back when you close it)" : null, "up to about 0.0007 SOL of network and priority fee"].filter(Boolean);
  return `Not enough SOL: this ${side} needs about ${need.toFixed(4)} SOL (${parts.join(", ")}). Your wallet has ${has.toFixed(4)} SOL.`;
}

/**
 * Impact sur le prix. Sur une bonding curve pump.fun, Jupiter renvoie souvent 1 (= inconnu), qui s'affichait "100 %" :
 * on le calcule nous-mêmes en comparant le prix obtenu au prix actuel de la courbe (frais pump.fun compris).
 * null = inconnu (on n'affiche rien plutôt qu'un chiffre faux).
 */
async function priceImpact(side: "buy" | "sell", mint: string, swapAmount: bigint, b: JupBuild): Promise<number | null> {
  const jup = Number(b.priceImpactPct);
  // Lecture fraîche (pas de cache) : sur une petite courbe, 2 s suffisent à fausser le calcul
  const info = await rpc().getAccountInfo(curvePda(mint)).catch(() => null);
  const c = info && info.owner.toBase58() === PUMP_PROGRAM_ID ? decodeCurve(info.data) : null;
  if (c && !c.complete && c.quoteMint === SOL && c.vTok > 0) {
    const spot = c.vQuote / c.vTok; // lamports par unité brute de token
    const inAmt = side === "buy" ? Number(swapAmount) : Number(b.inAmount);
    const out = Number(b.outAmount);
    if (inAmt > 0 && out > 0) {
      const effective = side === "buy" ? inAmt / out : out / inAmt;
      const impact = side === "buy" ? effective / spot - 1 : 1 - effective / spot;
      if (Number.isFinite(impact)) return Math.max(0, Math.min(0.99, impact));
    }
  }
  return Number.isFinite(jup) && jup >= 0 && jup < 0.99 ? jup : null;
}

/** Envoie une transaction signée par l'utilisateur et attend la confirmation. */
export async function sendSigned(b64: string): Promise<{ signature: string; status: "confirmed" | "failed" | "pending" }> {
  const conn = rpc();
  const raw = Buffer.from(b64, "base64");
  // On ne relaie que des trades Vigil (la transaction doit payer le wallet de fees)
  const feeWallet = process.env.VIGIL_FEE_WALLET;
  let vtx: VersionedTransaction;
  try {
    vtx = VersionedTransaction.deserialize(raw);
  } catch {
    throw new UserError("Invalid transaction.");
  }
  if (!feeWallet || !vtx.message.staticAccountKeys.some((k) => k.toBase58() === feeWallet)) throw new UserError("Only Vigil trades can be sent here.", 403);
  // Diffusée à 2 nœuds (Helius + RPC public Solana), relancée toutes les 2 s, état vérifié toutes les 0,4 s (F-072)
  const signature = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  const extra = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const blast = () => void Promise.allSettled([conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }), extra.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })]);
  blast();
  const start = Date.now();
  let lastBlast = start;
  while (Date.now() - start < 40_000) {
    await new Promise((res) => setTimeout(res, 400));
    const st = (await conn.getSignatureStatuses([signature]).catch(() => null))?.value[0];
    if (st?.err) return { signature, status: "failed" };
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return { signature, status: "confirmed" };
    if (Date.now() - lastBlast > 2000) {
      lastBlast = Date.now();
      blast();
    }
  }
  return { signature, status: "pending" };
}
