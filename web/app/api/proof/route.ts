import { cdn } from "@/lib/server/cdn";
import { brand } from "@/brand.config";
import { buybacks } from "@/lib/server/buybacks";
import { syncLedger, totals } from "@/lib/server/ledger";
import { cached, errorResponse } from "@/lib/server/rpc";

export const maxDuration = 60;

/**
 * Tout ce qu'il faut pour vérifier Vigil de A à Z, relu sur la blockchain :
 * fees reçues (trade par trade), cashback versé, rachats et burns de $VIGIL, règles du scan.
 * Jamais le solde total des wallets (ils peuvent contenir autre chose) : seulement les mouvements Vigil.
 */
async function get() {
  try {
    const data = await cached("proof", 60_000, async () => {
      const [l, bb] = await Promise.all([syncLedger().catch(() => null), buybacks().catch(() => null)]);
      const t = l ? totals(l) : null;
      const feesSol = t ? Number(t.fees) / 1e9 : 0;
      const share = (label: RegExp) => brand.fees.split.find((s) => label.test(s.label))?.pct ?? 0;
      return {
        addresses: {
          cashback: process.env.VIGIL_CASHBACK_WALLET || null,
          buyback: process.env.VIGIL_BUYBACK_WALLET || null,
          token: process.env.VIGIL_TOKEN_MINT || null,
        },
        memos: { cashback: "vigil-cashback", buyback: "vigil-buyback", burn: "vigil-burn" },
        fees: {
          bps: brand.fees.tradeFeeBps,
          split: brand.fees.split,
          since: l?.startedAt ?? null,
          trades: t?.trades ?? 0,
          traders: t?.traders ?? 0,
          sol: feesSol,
          recent: (l?.recent ?? []).slice(0, 10).map((r) => ({ time: r.time, sol: Number(r.lamports) / 1e9 })),
        },
        cashback: { dueSol: (feesSol * share(/back/i)) / 100, paidSol: t ? Number(t.paid) / 1e9 : 0 },
        buyback: {
          dueSol: (feesSol * share(/buyback/i)) / 100,
          spentSol: bb?.solSpent ?? 0,
          bought: bb?.bought ?? 0,
          burned: bb?.burned ?? 0,
          held: bb?.held ?? 0,
          count: bb?.count ?? 0,
          recent: bb?.recent ?? [],
        },
        rules: brand.scan,
        syncedAt: Date.now(),
      };
    });
    return Response.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}

// Cache partagé Vercel : 60 s, puis servi pendant le recalcul jusqu'à 300 s
export const GET = cdn(60, 300, get);
