import "server-only";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { tradeAddress } from "./pump";
import { apiSlot, cached, getTxs, rpc, RPC_URL } from "./rpc";

export type Trade = {
  signature: string;
  time: number | null;
  side: "buy" | "sell";
  trader: string;
  sol: number; // SOL dépensés (achat) ou reçus (vente), frais réseau compris
  tokens: string; // quantité brute
  viaVigil: boolean;
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const memory = new Map<string, { trades: Trade[]; seen: Set<string> }>();

function toTrade(tx: ParsedTransactionWithMeta, signature: string, mint: string): Trade | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys;
  const trader = keys[0].pubkey.toBase58();
  let pre = 0n, post = 0n;
  for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === mint && b.owner === trader) pre += BigInt(b.uiTokenAmount.amount);
  for (const b of tx.meta.postTokenBalances ?? []) if (b.mint === mint && b.owner === trader) post += BigInt(b.uiTokenAmount.amount);
  const delta = post - pre;
  if (delta === 0n) return null;
  // SOL natif + wSOL du trader
  let lamports = BigInt(tx.meta.postBalances[0]) - BigInt(tx.meta.preBalances[0]);
  let wpre = 0n, wpost = 0n;
  for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === SOL_MINT && b.owner === trader) wpre += BigInt(b.uiTokenAmount.amount);
  for (const b of tx.meta.postTokenBalances ?? []) if (b.mint === SOL_MINT && b.owner === trader) wpost += BigInt(b.uiTokenAmount.amount);
  lamports += wpost - wpre;
  const fee = process.env.VIGIL_FEE_WALLET;
  return {
    signature,
    time: tx.blockTime ?? null,
    side: delta > 0n ? "buy" : "sell",
    trader,
    sol: Math.abs(Number(lamports)) / 1e9,
    tokens: (delta < 0n ? -delta : delta).toString(),
    viaVigil: !!fee && keys.some((k) => k.pubkey.toBase58() === fee),
  };
}

const HELIUS_KEY = RPC_URL.match(/api-key=([^&]+)/)?.[1] ?? null;
type EnhancedTx = {
  signature: string;
  timestamp: number;
  feePayer: string;
  transactionError?: unknown;
  accountData?: { account: string; nativeBalanceChange: number; tokenBalanceChanges?: { userAccount: string; mint: string; rawTokenAmount: { tokenAmount: string } }[] }[];
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint: string }[];
};

/** Les 40 derniers trades en 1 requête (API enrichie de Helius) au lieu de 40 lectures une par une. */
async function enhancedTrades(mint: string): Promise<Trade[] | null> {
  if (!HELIUS_KEY) return null;
  const { address, curve } = await tradeAddress(mint);
  await apiSlot(true);
  const r = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}&limit=40`, { cache: "no-store" });
  if (!r.ok) return null;
  const list = (await r.json()) as EnhancedTx[];
  if (!Array.isArray(list)) return null;
  const fee = process.env.VIGIL_FEE_WALLET;
  const out: Trade[] = [];
  for (const tx of list) {
    if (tx.transactionError) continue;
    // Le trader = celui qui échange le token avec la courbe (pas forcément le payeur : relais, routeurs)
    let trader = tx.feePayer;
    if (curve)
      for (const t of tx.tokenTransfers ?? []) {
        if (t.mint !== mint) continue;
        if (t.fromUserAccount === curve && t.toUserAccount) trader = t.toUserAccount;
        else if (t.toUserAccount === curve && t.fromUserAccount) trader = t.fromUserAccount;
      }
    let tok = 0n, lamports = 0n;
    for (const a of tx.accountData ?? []) {
      if (a.account === trader) lamports += BigInt(a.nativeBalanceChange || 0);
      for (const c of a.tokenBalanceChanges ?? []) {
        if (c.userAccount !== trader) continue;
        if (c.mint === mint) tok += BigInt(c.rawTokenAmount.tokenAmount);
        if (c.mint === SOL_MINT) lamports += BigInt(c.rawTokenAmount.tokenAmount);
      }
    }
    if (tok === 0n) continue;
    out.push({
      signature: tx.signature,
      time: tx.timestamp ?? null,
      side: tok > 0n ? "buy" : "sell",
      trader,
      sol: Math.abs(Number(lamports)) / 1e9,
      tokens: (tok < 0n ? -tok : tok).toString(),
      viaVigil: !!fee && (tx.accountData ?? []).some((a) => a.account === fee),
    });
  }
  return out;
}

/** Derniers trades d'un token (partagés entre tous les visiteurs, rafraîchis toutes les 3 s au plus). */
export function recentTrades(mint: string): Promise<Trade[]> {
  return cached(`trades:${mint}`, 3_000, async () => {
    const fast = await enhancedTrades(mint).catch(() => null);
    if (fast) return fast;
    const conn = rpc();
    const mem = memory.get(mint) ?? { trades: [], seen: new Set<string>() };
    const sigs = (await conn.getSignaturesForAddress(new PublicKey(mint), { limit: 40 })).filter((s) => !s.err && !mem.seen.has(s.signature));
    const fresh: Trade[] = [];
    for (let i = 0; i < sigs.length; i += 20) {
      const chunk = sigs.slice(i, i + 20);
      const txs = await getTxs(conn, chunk.map((s) => s.signature));
      txs.forEach((tx, j) => {
        mem.seen.add(chunk[j].signature);
        const t = tx && toTrade(tx, chunk[j].signature, mint);
        if (t) fresh.push(t);
      });
    }
    mem.trades = [...fresh, ...mem.trades].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 80);
    if (mem.seen.size > 3000) mem.seen = new Set(mem.trades.map((t) => t.signature));
    memory.set(mint, mem);
    if (memory.size > 300) memory.delete(memory.keys().next().value as string);
    return mem.trades;
  });
}
