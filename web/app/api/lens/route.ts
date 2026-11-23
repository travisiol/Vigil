import { PublicKey } from "@solana/web3.js";
import { after } from "next/server";
import { rpc, withPriority } from "@/lib/server/rpc";
import { peekScan, scan } from "@/lib/server/scan";

/**
 * API de Vigil Lens (l'extension Chrome) `[F-080]`.
 * GET /api/lens?a=<adresse>,<adresse>…  (30 max : tokens ou paires DexScreener, tout ce que l'extension voit à l'écran)
 * Pour chaque adresse : le verdict déjà calculé, sinon "pending" et un scan rapide
 * lancé juste après la réponse ; l'extension redemande au bout de quelques secondes.
 * &peek=1 : lecture seule, aucun scan lancé (token ou pas ? verdict déjà connu ?) : l'extension s'en sert pour
 * savoir où poser sa marque « Scan », le vrai scan n'a lieu qu'au clic `[F-094]`.
 * Données publiques, lecture seule : ouverte à tous les sites (CORS).
 */
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SCANS_PER_CALL = 4; // scans rapides lancés au plus par appel (le reste au prochain passage)

type Out = { mint: string | null; verdict: "clean" | "watch" | "bundled" | null; reason: string | null; depth: string | null; pending: boolean; symbol: string | null; image: string | null };

// Adresse de paire DexScreener → adresse du token (gardé en mémoire : une paire ne change pas de token)
const pairToMint = new Map<string, string | null>();
async function resolvePairs(addrs: string[]) {
  const todo = addrs.filter((a) => !pairToMint.has(a));
  for (let i = 0; i < todo.length; i += 30) {
    const chunk = todo.slice(i, i + 30);
    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${chunk.join(",")}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { pairs?: { pairAddress: string; baseToken: { address: string } }[] } | null) : null;
    for (const a of chunk) pairToMint.set(a, j?.pairs?.find((p) => p.pairAddress === a)?.baseToken.address ?? null);
  }
  if (pairToMint.size > 20_000) pairToMint.delete(pairToMint.keys().next().value as string);
}

// Est-ce un token (mint) ? Un seul appel pour toutes les adresses inconnues
const isMintCache = new Map<string, boolean>();
async function mintFlags(addrs: string[]) {
  const todo = addrs.filter((a) => !isMintCache.has(a) && !a.endsWith("pump"));
  for (const a of addrs) if (a.endsWith("pump")) isMintCache.set(a, true);
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const infos = await rpc().getMultipleAccountsInfo(chunk.map((a) => new PublicKey(a))).catch(() => null);
    chunk.forEach((a, k) => {
      const inf = infos?.[k];
      const owner = inf?.owner.toBase58();
      isMintCache.set(a, !!inf && (owner === TOKEN || owner === TOKEN22) && inf.data.length >= 82 && inf.data.length !== 165);
    });
  }
  if (isMintCache.size > 50_000) isMintCache.delete(isMintCache.keys().next().value as string);
}

async function get(req: Request) {
  const raw = (new URL(req.url).searchParams.get("a") ?? "").split(",").map((x) => x.trim()).filter((x) => B58.test(x));
  const addrs = [...new Set(raw)].slice(0, 30);
  const peek = new URL(req.url).searchParams.get("peek") === "1";
  if (!addrs.length) return Response.json({ results: {} }, { headers: CORS });

  await mintFlags(addrs);
  await resolvePairs(addrs.filter((a) => !isMintCache.get(a)));

  const results: Record<string, Out> = {};
  const toScan: string[] = [];
  for (const a of addrs) {
    const mint = isMintCache.get(a) ? a : pairToMint.get(a) ?? null;
    if (!mint) {
      results[a] = { mint: null, verdict: null, reason: null, depth: null, pending: false, symbol: null, image: null };
      continue;
    }
    const s = peekScan(mint);
    const v = s ? { verdict: s.verdict, reason: s.reason, depth: s.depth } : null;
    if (!v) toScan.push(mint);
    results[a] = {
      mint,
      verdict: v?.verdict ?? null,
      reason: v?.reason ?? null,
      depth: v?.depth ?? null,
      pending: !v,
      symbol: s?.market?.symbol ?? null,
      image: s?.market?.image ?? null,
    };
  }
  // Scans rapides des tokens inconnus, après la réponse (Vercel garde la fonction en vie pour ça)
  const batch = peek ? [] : toScan.slice(0, SCANS_PER_CALL);
  if (batch.length) after(() => Promise.allSettled(batch.map((m) => withPriority(1, () => scan(m, "quick")))).then(() => {}));

  const allKnown = !Object.values(results).some((r) => r.pending);
  return Response.json(
    { results, at: Date.now() },
    // Tout est connu : réponse partagée 20 s par le cache de Vercel ; sinon jamais en cache (l'extension redemande)
    { headers: { ...CORS, "Cache-Control": allKnown ? "public, max-age=0, s-maxage=20, stale-while-revalidate=120" : "no-store" } },
  );
}

export async function GET(req: Request) {
  try {
    return await get(req);
  } catch {
    return Response.json({ results: {}, error: "lens unavailable" }, { status: 500, headers: CORS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
