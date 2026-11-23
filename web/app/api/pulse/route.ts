import { pulseRows } from "@/lib/server/launches";
import { errorResponse } from "@/lib/server/rpc";

/** Colonnes Final stretch (≥ 40 % de courbe) et Migrated (dernières 6 h). */
export async function GET(req: Request) {
  try {
    const list = new URL(req.url).searchParams.get("list") === "migrated" ? "migrated" : "final";
    return Response.json({ tokens: await pulseRows(list), at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}
