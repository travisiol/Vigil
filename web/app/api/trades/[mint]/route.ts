import { cdn } from "@/lib/server/cdn";
import { recentTrades } from "@/lib/server/trades";
import { solUsd } from "@/lib/server/pump";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

async function get(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    const [trades, sol] = await Promise.all([recentTrades(mint), solUsd()]);
    return Response.json({ trades, solUsd: sol, at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 2 s, puis servi pendant le recalcul jusqu'à 20 s
export const GET = cdn(2, 20, get);
