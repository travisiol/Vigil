import { cdn } from "@/lib/server/cdn";
import { trending } from "@/lib/server/dex";
import { errorResponse } from "@/lib/server/rpc";

async function get() {
  try {
    return Response.json({ tokens: await trending(), at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 20 s, puis servi pendant le recalcul jusqu'à 120 s
export const GET = cdn(20, 120, get);
