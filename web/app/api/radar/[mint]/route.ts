import { cdn } from "@/lib/server/cdn";
import { exitRadar } from "@/lib/server/radar";
import { cached, errorResponse, isMint, UserError } from "@/lib/server/rpc";

/** Radar de sortie : le dev et les wallets du lancement vendent-ils ? (rafraîchi toutes les 3 s au plus) */
async function get(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    return Response.json(await cached(`radar:${mint}`, 3_000, () => exitRadar(mint)));
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 3 s, puis servi pendant le recalcul jusqu'à 30 s
export const GET = cdn(3, 30, get);
