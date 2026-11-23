"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";

type Pos = {
  amount: number;
  raw: string;
  decimals: number;
  valueUsd: number | null;
  valueSol: number | null;
  avgEntrySol: number | null;
  entryMcapUsd: number | null;
  costSol: number | null;
  unrealizedSol: number | null;
  unrealizedPct: number | null;
  pnlSol: number | null;
  buys: number;
  sells: number;
  spentSol: number | null;
  receivedSol: number | null;
};

const n = (x: number, d = 2) => x.toLocaleString("en-US", { maximumFractionDigits: d });
const sol = (x: number | null) => (x == null ? "–" : `${x >= 0 ? "" : "−"}${n(Math.abs(x), Math.abs(x) < 1 ? 4 : 3)} SOL`);

/**
 * Ta position (F-066) : visible dès que l'achat est confirmé, mise à jour en direct, vente en 1 clic.
 * Après un trade, la carte se rafraîchit plusieurs fois (le temps que la blockchain et l'historique suivent).
 */
export default function Position({ mint, symbol }: { mint: string; symbol: string }) {
  const { publicKey } = useWallet();
  const [p, setP] = useState<Pos | null>(null);
  const [pending, setPending] = useState<{ side: "buy" | "sell"; tokens: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = useCallback(
    async (fresh = false) => {
      if (!publicKey) return setP(null);
      const r = await fetch(`/api/position?owner=${publicKey.toBase58()}&mint=${mint}${fresh ? "&fresh=1" : ""}`).catch(() => null);
      if (!r?.ok) return;
      const j = (await r.json()) as Pos;
      setP(j);
    },
    [publicKey, mint],
  );

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  // Juste après un trade : affichage immédiat, puis relectures à 1,5 s, 4 s et 9 s
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ side: "buy" | "sell"; tokens: number }>).detail;
      setPending(d);
      timers.current.forEach(clearTimeout);
      timers.current = [600, 1500, 3000, 5000, 9000].map((ms) => setTimeout(() => load(true), ms));
      timers.current.push(setTimeout(() => setPending(null), 9500));
    };
    window.addEventListener("vigil:traded", on);
    return () => {
      window.removeEventListener("vigil:traded", on);
      timers.current.forEach(clearTimeout);
    };
  }, [load]);

  if (!publicKey) return null;
  // Quelques centimes restés après une vente = position fermée (on ne montre pas "0 GTA6, −58 %")
  const dust = !!p && (p.valueUsd != null ? p.valueUsd < 0.05 : p.amount < 1e-6);
  const has = (p?.amount ?? 0) > 0 && !dust;
  const closed = !!p && !has && p.buys > 0 && p.sells > 0;
  if (!has && !pending && !closed) return null;
  const realized = closed && p.spentSol != null && p.receivedSol != null ? p.receivedSol - p.spentSol : null;

  const up = (p?.unrealizedSol ?? 0) >= 0;
  const sell = (pct: number) => {
    window.dispatchEvent(new CustomEvent("vigil:sell", { detail: pct }));
    document.getElementById("trade")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <section className="card pos" aria-live="polite">
      <div className="pos-h">
        <b>Your position</b>
        {pending && <span className="mut pos-upd"><span className="dotlive" aria-hidden="true" /> updating after your {pending.side}…</span>}
      </div>
      {has && p ? (
        <>
          <div className="pos-main">
            <div>
              <span className="mut">Holding</span>
              <b className="mono">{n(p.amount, 0)} {symbol}</b>
              <span className="mono mut">{p.valueSol != null ? `${sol(p.valueSol)} · ` : ""}{usd(p.valueUsd)}</span>
            </div>
            <div className="r">
              <span className="mut">Unrealized PnL</span>
              <b className={`mono ${up ? "up" : "dn"}`}>{p.unrealizedPct == null ? "–" : `${up ? "+" : ""}${(p.unrealizedPct * 100).toFixed(1)}%`}</b>
              <span className={`mono ${up ? "up" : "dn"}`}>{p.unrealizedSol == null ? "" : `${up ? "+" : ""}${sol(p.unrealizedSol)}`}</span>
            </div>
          </div>
          <div className="pos-meta mono mut">
            {p.avgEntrySol != null && <span>Entry {p.entryMcapUsd ? `MC ${usd(p.entryMcapUsd)}` : `${p.avgEntrySol.toExponential(2)} SOL`}</span>}
            {p.costSol != null && <span>Cost {sol(p.costSol)}</span>}
            <span>{p.buys} buy{p.buys === 1 ? "" : "s"} · {p.sells} sell{p.sells === 1 ? "" : "s"}</span>
          </div>
          <div className="pos-sell">
            {[25, 50, 100].map((pct) => (
              <button key={pct} className="btn btn-sell" onClick={() => sell(pct)}>Sell {pct}%</button>
            ))}
          </div>
        </>
      ) : pending?.side === "buy" ? (
        <p className="mut" style={{ fontSize: 13 }}>About {n(pending.tokens, 0)} {symbol} on the way…</p>
      ) : (
        <div className="pos-main">
          <div>
            <span className="mut">Position closed</span>
            <b className="mono">{p?.buys ?? 0} buy{p?.buys === 1 ? "" : "s"} · {p?.sells ?? 0} sell{p?.sells === 1 ? "" : "s"}</b>
          </div>
          <div className="r">
            <span className="mut">Realized PnL</span>
            <b className={`mono ${(realized ?? 0) >= 0 ? "up" : "dn"}`}>{realized == null ? "–" : `${realized >= 0 ? "+" : ""}${sol(realized)}`}</b>
            <span className={`mono ${(realized ?? 0) >= 0 ? "up" : "dn"}`}>{realized != null && p?.spentSol ? `${realized >= 0 ? "+" : ""}${((realized / p.spentSol) * 100).toFixed(1)}%` : ""}</span>
          </div>
        </div>
      )}
    </section>
  );
}
