import { PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { markets } from "@/lib/server/dex";
import { pumpMarket, solUsd } from "@/lib/server/pump";
import { apiSlot, cached, errorResponse, isMint, rpcPriority, RPC_URL, UserError } from "@/lib/server/rpc";

/**
 * Ta position sur un token (F-066), juste après l'achat : quantité détenue (lue sur la blockchain),
 * prix d'entrée et PnL calculés à partir de tes propres achats et ventes de ce token (historique du wallet, via Helius).
 */
const KEY = RPC_URL.match(/api-key=([^&]+)/)?.[1] ?? null;
const SOL = "So11111111111111111111111111111111111111112";

type Ehx = {
  signature: string;
  timestamp: number;
  transactionError?: unknown;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; tokenAmount: number; mint: string }[];
  accountData?: { account: string; nativeBalanceChange: number }[];
};

async function history(owner: string, mint: string) {
  // Achats et ventes de ce token par ce wallet (les 100 dernières transactions du wallet)
  if (!KEY) return null;
  await apiSlot(true);
  const r = await fetch(`https://api.helius.xyz/v0/addresses/${owner}/transactions?api-key=${KEY}&limit=100`, { cache: "no-store" });
  if (!r.ok) return null;
  const list = (await r.json()) as Ehx[];
  if (!Array.isArray(list)) return null;
  let bought = 0, spent = 0, sold = 0, received = 0, buys = 0, sells = 0, first: number | null = null, received_free = 0;
  for (const tx of list) {
    if (tx.transactionError) continue;
    let tok = 0, wsol = 0;
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint === mint) {
        if (t.toUserAccount === owner) tok += t.tokenAmount;
        if (t.fromUserAccount === owner) tok -= t.tokenAmount;
      } else if (t.mint === SOL) {
        if (t.toUserAccount === owner) wsol += t.tokenAmount;
        if (t.fromUserAccount === owner) wsol -= t.tokenAmount;
      }
    }
    if (!tok) continue;
    const lamports = tx.accountData?.find((a) => a.account === owner)?.nativeBalanceChange ?? 0;
    const sol = lamports / 1e9 + wsol; // frais réseau et fee Vigil compris : c'est ce que le trade t'a vraiment coûté
    if (tok > 0) {
      // Des tokens reçus sans vrai paiement (envoi, wallet de bundle payé par un autre) ne sont pas un achat : pas de prix d'entrée inventé
      if (-sol < 0.0005) {
        received_free += tok;
        continue;
      }
      bought += tok;
      spent += -sol;
      buys++;
      first = Math.min(first ?? tx.timestamp, tx.timestamp);
    } else {
      sold += -tok;
      received += Math.max(0, sol);
      sells++;
    }
  }
  return { bought, spent, sold, received, buys, sells, first, receivedFree: received_free };
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const owner = u.searchParams.get("owner") ?? "";
    const mint = u.searchParams.get("mint") ?? "";
    if (!isMint(owner)) throw new UserError("Connect your wallet.");
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    const fresh = u.searchParams.get("fresh") === "1";
    const data = await cached(`position:${owner}:${mint}${fresh ? `:${Date.now()}` : ""}`, 4_000, async () => {
      const conn = rpcPriority();
      const pk = new PublicKey(owner);
      const mk = new PublicKey(mint);
      // Le filtre par mint trouve les comptes du token, Token classique ou Token-2022
      const [a, h, m, sUsd] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(pk, { mint: mk }).catch(() => ({ value: [] })),
        history(owner, mint).catch(() => null),
        markets([mint]).then((x) => x.get(mint) ?? null).catch(() => null).then((x) => x ?? pumpMarket(mint).catch(() => null)),
        solUsd(),
      ]);
      let raw = 0n, decimals = 6;
      for (const acc of a.value) {
        const info = (acc.account.data as ParsedAccountData).parsed.info as { tokenAmount: { amount: string; decimals: number } };
        raw += BigInt(info.tokenAmount.amount);
        decimals = info.tokenAmount.decimals;
      }
      const amount = Number(raw) / 10 ** decimals;
      const price = m?.priceUsd ?? null;
      const valueUsd = price != null ? amount * price : null;
      const valueSol = valueUsd != null && sUsd ? valueUsd / sUsd : null;
      // Prix d'entrée moyen (en SOL par token) sur tes achats ; coût de ce que tu détiens encore
      const avg = h && h.bought > 0 ? h.spent / h.bought : null;
      // Coût connu seulement pour la part réellement achetée (pas pour des tokens reçus gratuitement)
      const paidPart = h ? Math.min(amount, Math.max(0, h.bought - h.sold)) : 0;
      const cost = avg != null && paidPart > 0 && paidPart >= amount * 0.9 ? avg * amount : null;
      const pnlSol = valueSol != null && cost != null ? valueSol - cost + (h ? h.received - (avg ?? 0) * h.sold : 0) : null;
      const unrealized = valueSol != null && cost != null ? valueSol - cost : null;
      return {
        amount,
        raw: raw.toString(),
        decimals,
        priceUsd: price,
        valueUsd,
        valueSol,
        avgEntrySol: avg,
        entryMcapUsd: avg != null && sUsd && m?.mcap && price ? (avg * sUsd / price) * m.mcap : null,
        costSol: cost,
        unrealizedSol: unrealized,
        unrealizedPct: unrealized != null && cost ? unrealized / cost : null,
        pnlSol,
        buys: h?.buys ?? 0,
        sells: h?.sells ?? 0,
        spentSol: h?.spent ?? null,
        receivedSol: h?.received ?? null,
        firstBuyAt: h?.first ?? null,
      };
    });
    return Response.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}
