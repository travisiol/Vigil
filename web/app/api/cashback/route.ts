import { brand } from "@/brand.config";
import { cashbackOf, syncLedger } from "@/lib/server/ledger";
import { errorResponse, isMint, UserError } from "@/lib/server/rpc";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
    if (!isMint(wallet)) throw new UserError("Connect your wallet.");
    const l = await syncLedger();
    const c = cashbackOf(l?.wallets[wallet]);
    return Response.json({
      live: !!l,
      cashbackPct: brand.fees.cashbackPct,
      minSol: brand.fees.cashbackMinSol,
      payoutHourUtc: brand.fees.payoutHourUtc,
      cashbackWallet: process.env.VIGIL_CASHBACK_WALLET || null,
      trades: c.trades,
      feesPaid: c.feesPaid.toString(),
      earned: c.earned.toString(),
      paid: c.paid.toString(),
      owed: c.owed.toString(),
      lastTrade: c.lastTrade,
      syncedAt: l?.syncedAt ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
