import { cdn } from "@/lib/server/cdn";
import { sampleCurve, sampledTicks, ticks, toCandles } from "@/lib/server/candles";
import { gmgnKline } from "@/lib/server/gmgn";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

const RES: Record<string, number> = { "1s": 1, "15s": 15, "30s": 30, "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

/**
 * Bougies du graphique Vigil.
 * 1 s et 15 s : trades on-chain (prix exact payé à la courbe) + relevé du prix sur la courbe chaque seconde.
 * Au-delà : GMGN (historique complet), avec repli sur les trades on-chain.
 */
async function get(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    const res = new URL(req.url).searchParams.get("res") ?? "1s";
    const step = RES[res] ?? 1;
    if (step >= 30) {
      const g = await gmgnKline(mint, res).catch(() => null);
      if (g && g.length) return Response.json({ source: "gmgn", res, candles: g });
    }
    const [list] = await Promise.all([ticks(mint).catch(() => null), sampleCurve(mint).catch(() => {})]);
    const all = [...(list ?? []), ...sampledTicks(mint)].sort((a, b) => a.t - b.t);
    return Response.json({ source: "chain", res, candles: toCandles(all, step) });
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 2 s, puis servi pendant le recalcul jusqu'à 20 s
export const GET = cdn(2, 20, get);
