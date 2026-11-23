import { feedVerdict } from "@/lib/server/launches";
import { isMint } from "@/lib/server/rpc";

// Verdict instantané d'un token déjà vu par le flux (affiché pendant que le scan de la page tourne)
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return Response.json({ verdict: null });
  return Response.json({ verdict: feedVerdict(mint) });
}
