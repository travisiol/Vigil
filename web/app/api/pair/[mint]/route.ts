import { markets } from "@/lib/server/dex";
import { curvePda, isPumpToken } from "@/lib/server/pump";
import { isMint } from "@/lib/server/rpc";

// Réponse éclair (~0,2 s) : la paire DexScreener du token, et sa bonding curve pump.fun s'il en a une
// (sert au graphique TradingView quand l'adresse du token ne finit pas par "pump").
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (!isMint(mint)) return Response.json({ pairAddress: null, curve: null });
  const timeout = <T,>(p: Promise<T>, ms: number, v: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(v), ms))]);
  const [m, pump] = await Promise.all([
    // Réponse en 0,8 s au plus : si DexScreener tarde, l'écran montre le graphique Vigil et redemande dans 5 s
    timeout(markets([mint]).then((x) => x.get(mint) ?? null).catch(() => null), 800, null),
    isPumpToken(mint).catch(() => false),
  ]);
  return Response.json({ pairAddress: m?.pairAddress ?? null, curve: pump ? curvePda(mint).toBase58() : null });
}
