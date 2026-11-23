import { brand } from "@/brand.config";
import { syncLedger, totals } from "@/lib/server/ledger";
import { cached, errorResponse } from "@/lib/server/rpc";

export const maxDuration = 60;

// Uniquement ce qui vient des trades Vigil (lu dans le registre), jamais le solde total du wallet :
// le wallet peut contenir d'autres fonds qui ne sont pas des fees.
export async function GET() {
  try {
    const wallet = process.env.VIGIL_FEE_WALLET || null;
    const cashbackWallet = process.env.VIGIL_CASHBACK_WALLET || null;
    // L'adresse du wallet de fees n'est pas publiée (F-073) : seulement les montants, relus sur la blockchain
    const base = { live: !!wallet, cashbackWallet, feeBps: brand.fees.tradeFeeBps, split: brand.fees.split };
    if (!wallet) return Response.json(base);
    const data = await cached("fees", 30_000, async () => {
      const l = await syncLedger();
      if (!l) return {};
      const t = totals(l);
      return {
        since: l.startedAt || null,
        totals: { feesSol: Number(t.fees) / 1e9, cashbackPaidSol: Number(t.paid) / 1e9, trades: t.trades, traders: t.traders },
        recent: l.recent.map((r) => ({ time: r.time, sol: Number(r.lamports) / 1e9 })),
      };
    });
    return Response.json({ ...base, ...data });
  } catch (e) {
    return errorResponse(e);
  }
}
