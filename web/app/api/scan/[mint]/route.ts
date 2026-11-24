import { cors } from "@/lib/server/cors";
import { scan } from "@/lib/server/scan";
import { errorResponse, isMint, UserError, withPriority } from "@/lib/server/rpc";

export const maxDuration = 120;

// ?depth=quick : verdict rapide (lancement, holders, dev) · par défaut : complet (+ financements)
async function get(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    const depth = new URL(req.url).searchParams.get("depth") === "quick" ? "quick" : "full";
    // un scan demandé ici l'est par quelqu'un (clic dans l'extension, page d'un token) : il passe devant tout le reste
    return Response.json(await withPriority(0, () => scan(mint, depth)));
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = cors(get);
