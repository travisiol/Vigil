import "server-only";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { cached, getTxs, rpc } from "./rpc";

/**
 * Le registre des rachats et des burns de $VIGIL, relu entièrement sur la blockchain (rien n'est déclaré à la main).
 * Chaque rachat est une transaction du wallet de rachat avec le mémo "vigil-buyback" ; chaque burn porte le mémo "vigil-burn".
 * N'importe qui peut refaire le calcul en ouvrant le wallet de rachat sur Solscan.
 */
export const BUYBACK_MEMO = "vigil-buyback";
export const BURN_MEMO = "vigil-burn";

export type BuybackEvent = { signature: string; time: number | null; kind: "buyback" | "burn"; sol: number; tokens: number };
export type Buybacks = {
  wallet: string | null;
  mint: string | null;
  solSpent: number;
  bought: number;
  burned: number;
  held: number; // $VIGIL rachetés encore dans le wallet de rachat (l'autre moitié, non brûlée)
  count: number;
  recent: BuybackEvent[];
  syncedAt: number;
};

const memoOf = (tx: ParsedTransactionWithMeta) =>
  tx.transaction.message.instructions
    .map((ix) => ("parsed" in ix && ix.program === "spl-memo" ? String(ix.parsed) : ""))
    .join(" ");

/** Montant de tokens $VIGIL gagné / perdu par le wallet dans une transaction (soldes avant / après). */
function tokenDelta(tx: ParsedTransactionWithMeta, owner: string, mint: string): number {
  const sum = (list: { mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } }[] | null | undefined) =>
    (list ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((s, b) => s + Number(b.uiTokenAmount.uiAmount ?? 0), 0);
  return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
}

export function buybacks(): Promise<Buybacks> {
  const wallet = process.env.VIGIL_BUYBACK_WALLET || null;
  const mint = process.env.VIGIL_TOKEN_MINT || null;
  return cached("buybacks", 120_000, async () => {
    const empty: Buybacks = { wallet, mint, solSpent: 0, bought: 0, burned: 0, held: 0, count: 0, recent: [], syncedAt: Date.now() };
    if (!wallet || !mint) return empty;
    const conn = rpc();
    const owner = new PublicKey(wallet);
    const sigs = (await conn.getSignaturesForAddress(owner, { limit: 1000 })).filter((s) => !s.err);
    const txs = await getTxs(conn, sigs.map((s) => s.signature));
    const out = { ...empty };
    const events: BuybackEvent[] = [];
    txs.forEach((tx, i) => {
      if (!tx?.meta) return;
      const memo = memoOf(tx);
      const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
      const idx = keys.indexOf(wallet);
      const lamports = idx >= 0 ? tx.meta.postBalances[idx] - tx.meta.preBalances[idx] : 0;
      const d = tokenDelta(tx, wallet, mint);
      if (memo.includes(BUYBACK_MEMO) && d > 0) {
        const sol = Math.max(0, -lamports) / 1e9;
        out.solSpent += sol;
        out.bought += d;
        out.count++;
        events.push({ signature: sigs[i].signature, time: tx.blockTime ?? null, kind: "buyback", sol, tokens: d });
      } else if (memo.includes(BURN_MEMO) && d < 0) {
        out.burned += -d;
        events.push({ signature: sigs[i].signature, time: tx.blockTime ?? null, kind: "burn", sol: 0, tokens: -d });
      }
    });
    // Ce qui reste dans le wallet de rachat, lu maintenant
    const accs = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }).catch(() => null);
    out.held = (accs?.value ?? []).reduce((s, a) => s + Number((a.account.data as { parsed: { info: { tokenAmount: { uiAmount: number | null } } } }).parsed.info.tokenAmount.uiAmount ?? 0), 0);
    out.recent = events.sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 30);
    out.syncedAt = Date.now();
    return out;
  });
}
