import { cdn } from "@/lib/server/cdn";
import { isMint } from "@/lib/server/rpc";
import { peekScan } from "@/lib/server/scan";

// Verdict déjà connu d'un token (affiché tout de suite pendant que le scan de la page tourne)
async function get(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return Response.json({ verdict: null });
  const s = peekScan(mint);
  return Response.json({
    verdict: s
      ? { mint: s.mint, verdict: s.verdict, reason: s.reason, depth: s.depth, checkedAt: s.checkedAt, signals: { top10Pct: s.signals.top10Pct, early10s: { pct: s.signals.early10s.pct }, dev: { holdsPct: s.signals.dev.holdsPct } } }
      : null,
  });
}

// Cache partagé Vercel : 5 s, puis servi pendant le recalcul jusqu'à 30 s
export const GET = cdn(5, 30, get);
