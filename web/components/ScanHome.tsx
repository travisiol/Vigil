"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { startOpening } from "@/lib/client/opening";
import { holdScans, useScans } from "@/lib/client/scans";
import { pct, price, usd } from "@/lib/format";
import type { Market, Scan, ScanLite } from "@/lib/types";
import { Pill, TokenIcon } from "./ui";

/**
 * Page Scan (F-080) : colle un CA pour le scanner, ou ouvre un token qui tourne en ce moment.
 * Plus de flux temps réel : tout est calculé à la demande (c'est ce qui marche sur Vercel). Vigil Lens fait le reste dans le navigateur.
 */
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SCAN_TOP = 15;

export default function ScanHome() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [bad, setBad] = useState(false);
  const [rows, setRows] = useState<Market[] | null>(null);
  const [err, setErr] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    let alive = true;
    const load = () =>
      fetch("/api/trending")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => alive && (setRows(j.tokens as Market[]), setErr(false)))
        .catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const quick = useMemo(() => (rows ?? []).slice(0, SCAN_TOP).map((t) => t.mint), [rows]);
  const getScan = useScans(quick, []);

  const open = (mint: string, t?: Market, s?: Scan | ScanLite | null) => {
    startOpening({ mint, symbol: t?.symbol, name: t?.name, image: t?.image, verdict: s?.verdict ?? null });
    holdScans();
    router.push(`/token/${mint}`);
  };
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!B58.test(v)) return setBad(true);
    open(v);
  };

  return (
    <>
      <section className="scan-hero">
        <h1>Scan any <span className="grad-text">Solana token.</span></h1>
        <p className="mut">Paste a contract address. Vigil reads its launch, its dev, who funded the first buyers and what the insiders still hold.</p>
        <form className="scan-box" onSubmit={go} role="search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setBad(false); }} placeholder="Paste a contract address" aria-label="Contract address" spellCheck={false} />
          <button className="btn btn-main" type="submit">Scan</button>
        </form>
        {bad && <p className="msg err" role="alert">That doesn&apos;t look like a Solana contract address.</p>}
        <Link className="lens-pill" href="/lens">
          <span className="dotlive" aria-hidden="true" /> Get these verdicts inside Axiom, GMGN and pump.fun with <b>the Vigil extension</b> →
        </Link>
      </section>

      <section className="card">
        <div className="card-h">
          <h2 style={{ fontSize: 16 }}>Trending now</h2>
          <span className="mut" style={{ fontSize: 12 }}>The Solana tokens trading most, each one scanned</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Token</th>
                <th className="r">Price</th>
                <th className="r">MCap</th>
                <th className="r hide-m">Liquidity</th>
                <th className="r hide-m">1h</th>
                <th>Vigil</th>
                <th className="hide-m">Why</th>
              </tr>
            </thead>
            <tbody>
              {!rows && !err && Array.from({ length: 8 }, (_, i) => <tr key={i} className="skel">{Array.from({ length: 7 }, (_, j) => <td key={j}><div /></td>)}</tr>)}
              {(rows ?? []).map((t, i) => {
                const c = getScan(t.mint);
                const s = c && typeof c === "object" ? c : null;
                const v = s ? s.verdict : i < SCAN_TOP ? "scanning" : "unknown";
                return (
                  <tr key={t.mint} className={`v-${s?.verdict ?? "none"}`} onClick={() => open(t.mint, t, s)}>
                    <td><div className="tok"><TokenIcon src={t.image} alt="" symbol={t.symbol} /><div><b>{t.symbol}</b><span>{t.name}</span></div></div></td>
                    <td className="r mono">{price(t.priceUsd)}</td>
                    <td className="r mono">{usd(t.mcap)}</td>
                    <td className="r mono hide-m">{t.dexId === "pumpfun" ? <span className="mut">curve</span> : usd(t.liquidity)}</td>
                    <td className={`r mono hide-m ${(t.change1h ?? 0) >= 0 ? "up" : "dn"}`}>{pct(t.change1h)}</td>
                    <td>{v === "unknown" ? <span className="mut" style={{ fontSize: 12 }}>Open to scan</span> : <Pill v={v} title={s?.reason} />}</td>
                    <td className="hide-m"><div className="why">{s ? s.reason : c === "error" ? "Could not read this token right now" : i < SCAN_TOP ? "Reading the chain…" : ""}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {err && !rows && <p className="empty">Couldn&apos;t load trending tokens right now.</p>}
        </div>
      </section>
      <p className="mut" style={{ fontSize: 12, marginTop: 12 }}>Facts from the chain, not financial advice. A clean token can still go to zero.</p>
    </>
  );
}
