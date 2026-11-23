import { sendSigned } from "@/lib/server/swap";
import { errorResponse, UserError } from "@/lib/server/rpc";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { tx } = (await req.json()) as { tx?: string };
    if (!tx) throw new UserError("Missing transaction.");
    return Response.json(await sendSigned(tx));
  } catch (e) {
    return errorResponse(e);
  }
}
