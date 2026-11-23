import { trending } from "@/lib/server/dex";
import { errorResponse } from "@/lib/server/rpc";

export async function GET() {
  try {
    return Response.json({ tokens: await trending(), at: Date.now() });
  } catch (e) {
    return errorResponse(e);
  }
}
