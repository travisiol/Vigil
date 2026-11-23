import { cdn } from "@/lib/server/cdn";
import { after } from "next/server";
import { newPairsFast } from "@/lib/server/launches";
import { errorResponse } from "@/lib/server/rpc";

async function get() {
  try {
    const { rows, pending } = await newPairsFast();
    // Calcul pas fini : il continue après la réponse (Vercel garde la fonction en vie pour ça)
    if (pending) after(() => pending.then(() => {}).catch(() => {}));
    // Liste encore partielle (copie du serveur qui vient de démarrer) : jamais gardée dans le cache partagé
    return Response.json({ tokens: rows, at: Date.now() }, rows.length < 40 ? { headers: { "Cache-Control": "no-store" } } : undefined);
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 2 s, puis servi pendant le recalcul jusqu'à 30 s
export const GET = cdn(2, 30, get);
