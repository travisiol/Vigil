"use client";
import { useEffect, useMemo, useState } from "react";
import { price } from "@/lib/format";

type Trade = { signature: string; time: number | null; side: "buy" | "sell"; sol: number; tokens: string };

/**
 * Graphique en direct tracé à partir des trades, pour les tokens que DexScreener ne connaît pas encore.
 * Prix de chaque trade = SOL échangés / tokens échangés, converti en $.
 */
export default function LiveChart({ mint, decimals }: { mint: string; decimals: number }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sol, setSol] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/trades/${mint}`);
        if (!r.ok) return;
        const j = (await r.json()) as { trades: Trade[]; solUsd: number | null };
        if (alive) {
          setTrades(j.trades);
          setSol(j.solUsd);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint]);

  const pts = useMemo(() => {
    const scale = 10 ** decimals;
    return trades
      .filter((t) => t.time && Number(t.tokens) > 0 && t.sol > 0)
      .map((t) => ({ t: t.time as number, p: (t.sol / (Number(t.tokens) / scale)) * (sol ?? 1), side: t.side }))
      .sort((a, b) => a.t - b.t);
  }, [trades, decimals, sol]);

  if (pts.length < 2)
    return <p className="empty">{trades.length ? "Waiting for more trades to draw the chart…" : "Loading live trades…"}</p>;

  const W = 1000, H = 300, pad = 16;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const ps = pts.map((x) => x.p).sort((a, b) => a - b);
  // on ignore les 2 % extrêmes (un trade minuscule peut avoir un prix aberrant)
  const lo = ps[Math.floor(ps.length * 0.02)], hi = ps[Math.ceil(ps.length * 0.98) - 1] || ps[ps.length - 1];
  const X = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const Y = (p: number) => H - pad - ((Math.min(hi, Math.max(lo, p)) - lo) / Math.max(hi - lo, hi * 1e-6)) * (H - pad * 2);
  const line = pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)} ${Y(x.p).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1], first = pts[0];
  const change = ((last.p - first.p) / first.p) * 100;

  return (
    <div className="livechart">
      <div className="lc-h">
        <b className="mono">{sol ? price(last.p) : `${last.p.toPrecision(3)} SOL`}</b>
        <span className={`mono ${change >= 0 ? "up" : "dn"}`}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>
        <span className="mut">from the last {pts.length} trades · DexScreener chart appears once it lists the token</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Live price from trades">
        <defs>
          <linearGradient id="lcg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#9232F1" />
            <stop offset=".5" stopColor="#BC33C9" />
            <stop offset="1" stopColor="#F22C7B" />
          </linearGradient>
          <linearGradient id="lcf" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#BC33C9" stopOpacity=".25" />
            <stop offset="1" stopColor="#BC33C9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${X(last.t).toFixed(1)} ${H} L${X(first.t).toFixed(1)} ${H} Z`} fill="url(#lcf)" />
        <path d={line} fill="none" stroke="url(#lcg)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {pts.map((x) => (
          <circle key={`${x.t}-${x.p}`} cx={X(x.t)} cy={Y(x.p)} r="3" fill={x.side === "buy" ? "#07E7C3" : "#FF4545"} opacity=".8" />
        ))}
      </svg>
    </div>
  );
}
