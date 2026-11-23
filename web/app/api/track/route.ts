import { newPairs } from "@/lib/server/launches";
import { trackRaw, trackRecord } from "@/lib/server/watch";

/** Le bulletin de notes des verdicts : chaque verdict du flux, noté 15 min après la création du token. */
export async function GET(req: Request) {
  void newPairs().catch(() => {}); // s'assure que le flux (et donc le suivi) tourne
  const u = new URL(req.url);
  const h = Number(u.searchParams.get("hours")) || 24;
  if (u.searchParams.get("raw") === "1")
    return new Response(JSON.stringify({ note: "Every Vigil verdict, frozen at launch and graded 15 min later. Never edited.", rows: trackRaw(Math.min(168, Math.max(1, h))) }, null, 1), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="vigil-track-record-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  return Response.json(trackRecord(Math.min(168, Math.max(1, h))));
}
