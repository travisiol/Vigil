"use client";
import { useEffect, useState } from "react";

export type RadarData = {
  status: "dumping" | "selling" | "holding" | "unknown";
  headline: string;
  insiders: number;
  devSoldShare: number | null;
  insidersBoughtPct: number | null;
  insidersSoldPct: number;
  stillHeldShare: number | null;
  stillHeldPct: number | null;
  soldLast5mPct: number;
  lastSellAgoS: number | null;
  events: { t: number; kind: "dev" | "coordinated" | "insider"; wallets: number; pctSupply: number; text: string }[];
  wallets: string[];
  coverageSince: number | null;
  trades: number;
};

const pc = (x: number | null) => (x == null ? "–" : `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`);
const ago = (s: number | null) => (s == null ? "never" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`);
const LABEL = { dumping: "Insiders are dumping", selling: "Insiders are selling", holding: "Insiders are holding", unknown: "Exit radar" } as const;

/** Le radar de sortie : rafraîchi toutes les 3 s tant que la page est ouverte. */
export function useRadar(mint: string, ready: boolean) {
  const [r, setR] = useState<RadarData | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () =>
      fetch(`/api/radar/${mint}`)
        .then((x) => (x.ok ? x.json() : null))
        .then((j) => alive && j && setR(j as RadarData))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint, ready]);
  return r;
}

export default function ExitRadar({ r }: { r: RadarData | null }) {
  const status = r?.status ?? "unknown";
  return (
    <section className={`card radar r-${status}`} aria-live="polite">
      <div className="radar-h">
        <span className="radar-dot" aria-hidden="true" />
        <div>
          <b>{LABEL[status]}</b>
          <p className="mut">{r ? r.headline || "Watching the launch wallets…" : "Watching the dev and every wallet that bought in the first 10 seconds…"}</p>
        </div>
        <span className="radar-tag mono">EXIT RADAR</span>
      </div>
      {r && r.insiders > 0 && (
        <div className="radar-stats">
          <div><span>Launch wallets watched</span><b className="mono">{r.insiders}</b></div>
          <div><span>Bought at launch</span><b className="mono">{pc(r.insidersBoughtPct)}</b></div>
          <div title="Read from their wallets right now: what the launch buyers still hold, out of what they bought">
            <span>Still holding</span>
            <b className={`mono ${r.stillHeldShare != null && r.stillHeldShare < 0.3 && (r.insidersBoughtPct ?? 0) >= 0.02 ? "dn" : ""}`}>{r.stillHeldShare == null ? pc(r.insidersSoldPct) + " sold" : `${Math.round(r.stillHeldShare * 100)}% of buy`}</b>
          </div>
          <div><span>Dev sold</span><b className={`mono ${(r.devSoldShare ?? 0) >= 0.5 ? "dn" : ""}`}>{r.devSoldShare == null ? "–" : `${Math.round(r.devSoldShare * 100)}% of bag`}</b></div>
          <div><span>Last insider sell</span><b className="mono">{ago(r.lastSellAgoS)}</b></div>
        </div>
      )}
      {r && r.events.length > 0 && (
        <ul className="radar-ev">
          {r.events.slice(0, 5).map((e, i) => (
            <li key={i} className={`k-${e.kind}`}>
              <span className="mono mut">{new Date(e.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
      {r && r.trades > 0 && <p className="radar-foot mut">Based on the last {r.trades.toLocaleString("en-US")} trades{r.coverageSince ? ` (since ${new Date(r.coverageSince * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}. Facts from the chain, not financial advice.</p>}
    </section>
  );
}
