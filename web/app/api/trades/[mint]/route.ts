import { recentTrades } from "@/lib/server/trades";
import { solUsd } from "@/lib/server/pump";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    const [trades, sol] = await Promise.all([recentTrades(mint), solUsd()]);
    return Response.json({ trades, solUsd: sol, at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}
