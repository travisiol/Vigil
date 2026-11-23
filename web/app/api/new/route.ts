import { newPairsFast } from "@/lib/server/launches";
import { errorResponse } from "@/lib/server/rpc";

export async function GET() {
  try {
    return Response.json({ tokens: await newPairsFast(), at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}
