import { after } from "next/server";
import { newPairsFast } from "@/lib/server/launches";
import { errorResponse } from "@/lib/server/rpc";

export async function GET() {
  try {
    const { rows, pending } = await newPairsFast();
    // Calcul pas fini : il continue après la réponse (Vercel garde la fonction en vie pour ça)
    if (pending) after(() => pending.then(() => {}).catch(() => {}));
    return Response.json({ tokens: rows, at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}
