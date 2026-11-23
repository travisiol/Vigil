import { scan } from "@/lib/server/scan";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

export const maxDuration = 120;

// ?depth=quick : verdict rapide (lancement, holders, dev) · par défaut : complet (+ financements)
export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    const depth = new URL(req.url).searchParams.get("depth") === "quick" ? "quick" : "full";
    return Response.json(await scan(mint, depth));
  } catch (e) {
    return errorResponse(e);
  }
}
