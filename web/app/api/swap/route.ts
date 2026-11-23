import { buildSwap } from "@/lib/server/swap";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { side?: string; mint?: string; amount?: string; taker?: string; slippageBps?: number };
    if (b.side !== "buy" && b.side !== "sell") throw new UserError("Choose buy or sell.");
    if (!b.mint || !isMint(b.mint) || !b.taker || !isMint(b.taker)) throw new UserError("Connect your wallet and pick a token.");
    if (!b.amount || !/^\d+$/.test(b.amount)) throw new UserError("Enter an amount.");
    return Response.json(await buildSwap({ side: b.side, mint: b.mint, amount: b.amount, taker: b.taker, slippageBps: Number(b.slippageBps) || 1000 }));
  } catch (e) {
    return errorResponse(e);
  }
}
