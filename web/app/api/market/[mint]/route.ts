import { cdn } from "@/lib/server/cdn";
import { markets } from "@/lib/server/dex";
import { gmgnInfo } from "@/lib/server/gmgn";
import { pumpMarket } from "@/lib/server/pump";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

// Prix / market cap en direct pour l'en-tête de la page token.
// DexScreener quand il connaît le token ; sinon la bonding curve pump.fun (+ volume et âge via GMGN).
async function get(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  try {
    const { mint } = await ctx.params;
    if (!isMint(mint)) throw new UserError("This address is not a token.", 404);
    return await compute(mint);
  } catch (e) {
    return errorResponse(e);
  }
}

async function compute(mint: string): Promise<Response> {
  {
    const ds = await markets([mint]).then((x) => x.get(mint) ?? null).catch(() => null);
    if (ds && ds.dexId !== "pumpfun") return Response.json({ market: ds });
    const [pump, gi] = await Promise.all([pumpMarket(mint).catch(() => null), ds ? Promise.resolve(null) : gmgnInfo(mint).catch(() => null)]);
    if (ds) return Response.json({ market: { ...ds, curvePct: pump?.curvePct ?? null, raisedUsd: pump?.raisedUsd ?? null, image: ds.image ?? pump?.image ?? null } });
    if (!pump) return Response.json({ market: null });
    const p0 = Number(gi?.price?.price_24h), p1 = Number(gi?.price?.price);
    return Response.json({
      market: {
        ...pump,
        image: pump.image ?? gi?.logo ?? null,
        volume24h: gi?.price?.volume_24h != null ? Number(gi.price.volume_24h) : null,
        change24h: p0 > 0 && p1 > 0 ? ((p1 - p0) / p0) * 100 : null,
        createdAt: gi?.creation_timestamp ? gi.creation_timestamp * 1000 : null,
      },
    });
  }
}

// Cache partagé Vercel : 3 s, puis servi pendant le recalcul jusqu'à 30 s
export const GET = cdn(3, 30, get);
