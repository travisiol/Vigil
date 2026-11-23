import { cdn } from "@/lib/server/cdn";
import { pulseRows } from "@/lib/server/launches";
import { errorResponse } from "@/lib/server/rpc";

/** Colonnes Final stretch (≥ 40 % de courbe) et Migrated (dernières 6 h). */
async function get(req: Request) {
  try {
    const list = new URL(req.url).searchParams.get("list") === "migrated" ? "migrated" : "final";
    return Response.json({ tokens: await pulseRows(list), at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 5 s, puis servi pendant le recalcul jusqu'à 60 s
export const GET = cdn(5, 60, get);
