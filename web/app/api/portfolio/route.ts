import { PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { markets } from "@/lib/server/dex";
import { errorResponse, isMint, rpc, UserError } from "@/lib/server/rpc";

const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export async function GET(req: Request) {
  try {
    const owner = new URL(req.url).searchParams.get("owner") ?? "";
    if (!isMint(owner)) throw new UserError("Connect your wallet.");
    const conn = rpc();
    const pk = new PublicKey(owner);
    const [lamports, a, b] = await Promise.all([
      conn.getBalance(pk),
      conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN }),
      conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN22 }),
    ]);
    const bal = new Map<string, { amount: bigint; decimals: number }>();
    for (const acc of [...a.value, ...b.value]) {
      const info = (acc.account.data as ParsedAccountData).parsed.info as { mint: string; tokenAmount: { amount: string; decimals: number } };
      const amt = BigInt(info.tokenAmount.amount);
      if (amt === 0n) continue;
      const cur = bal.get(info.mint);
      bal.set(info.mint, { amount: (cur?.amount ?? 0n) + amt, decimals: info.tokenAmount.decimals });
    }
    const mints = [...bal.keys()].slice(0, 90);
    const m = mints.length ? await markets(mints).catch(() => new Map()) : new Map();
    const holdings = mints
      .map((mint) => {
        const h = bal.get(mint)!;
        const ui = Number(h.amount) / 10 ** h.decimals;
        const market = m.get(mint) ?? null;
        return { mint, amount: h.amount.toString(), decimals: h.decimals, ui, valueUsd: market?.priceUsd != null ? ui * market.priceUsd : null, market };
      })
      .sort((x, y) => (y.valueUsd ?? -1) - (x.valueUsd ?? -1));
    return Response.json({ sol: lamports / 1e9, lamports, holdings });
  } catch (e) {
    return errorResponse(e);
  }
}
