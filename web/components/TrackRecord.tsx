"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usd } from "@/lib/format";
import type { Verdict } from "@/lib/types";
import { Pill } from "./ui";

type Outcome = "migrated" | "alive" | "faded" | "crashed" | "never";
type Row = { mint: string; symbol: string; createdAt: number; verdict: Verdict; reason: string; verdictAtS: number; outcome: Outcome; peakUsd: number; endUsd: number | null };
type Stat = { verdict: Verdict; n: number; counts: Record<Outcome, number>; realN: number; crashedOfReal: number; survivedOfReal: number };
type Data = { hours: number; total: number; since: number | null; byVerdict: Stat[]; recent: Row[]; tracking: number };

const OUT: { k: Outcome; label: string; color: string; help: string }[] = [
  { k: "migrated", label: "Migrated", color: "var(--vt)", help: "completed its bonding curve" },
  { k: "alive", label: "Still alive", color: "var(--ok)", help: "kept at least half of its peak, $1.5K+ in" },
  { k: "faded", label: "Faded", color: "#6E6880", help: "lost between 50% and 80% of its peak" },
  { k: "crashed", label: "Crashed", color: "var(--bad)", help: "lost 80% or more of its peak" },
  { k: "never", label: "Never took off", color: "#2E2A3A", help: "under $300 ever came in" },
];
const NAME: Record<Verdict, string> = { clean: "Clean", watch: "Watch", bundled: "Bundled" };
const pc = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

/** Le bulletin de notes public des verdicts : figés au lancement, notés 15 min après, jamais modifiés. */
export default function TrackRecord() {
  const [hours, setHours] = useState(24);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/track?hours=${hours}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => alive && (setD(j as Data), setErr(false)))
        .catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [hours]);

  return (
    <>
      <div className="hero-s">
        <h1>Every verdict, <span className="grad-text">graded.</span></h1>
        <p className="mut">
          The first verdict Vigil shows on each pump.fun launch is frozen. Fifteen minutes later, Vigil reads what the bonding curve became and grades it. Nothing is edited afterwards, good calls and bad ones alike.
        </p>
      </div>

      <div className="tr-bar">
        <div className="seg2" role="tablist" aria-label="Window">
          {[24, 168].map((h) => (
            <button key={h} role="tab" aria-selected={hours === h} onClick={() => setHours(h)}>{h === 24 ? "Last 24 h" : "Last 7 days"}</button>
          ))}
        </div>
        <span className="mut tr-meta">
          {d ? <>{d.total.toLocaleString("en-US")} launches graded · <span className="dotlive" aria-hidden="true" /> {d.tracking} being followed now</> : err ? "Couldn't load the track record." : "Loading…"}
        </span>
      </div>

      <div className="tr-grid">
        {(d?.byVerdict ?? (["clean", "watch", "bundled"] as Verdict[]).map((v) => ({ verdict: v, n: 0, counts: { migrated: 0, alive: 0, faded: 0, crashed: 0, never: 0 }, realN: 0, crashedOfReal: 0, survivedOfReal: 0 }))).map((s) => (
          <section key={s.verdict} className={`card tr-card v-${s.verdict}`}>
            <div className="tr-h">
              <Pill v={s.verdict} />
              <span className="mono mut">{s.n.toLocaleString("en-US")} tokens</span>
            </div>
            <div className="tr-stack" role="img" aria-label={OUT.map((o) => `${o.label} ${pc(s.counts[o.k], s.n)}`).join(", ")}>
              {OUT.map((o) => (s.counts[o.k] ? <i key={o.k} style={{ flexGrow: s.counts[o.k], background: o.color }} title={`${o.label}: ${s.counts[o.k]}`} /> : null))}
              {!s.n && <i style={{ flexGrow: 1, background: "var(--s2)" }} />}
            </div>
            <dl className="tr-key">
              <div><dt>Crashed</dt><dd className="mono" style={{ color: "var(--bad)" }}>{pc(s.crashedOfReal, s.realN)}</dd></div>
              <div><dt>Survived</dt><dd className="mono" style={{ color: "var(--ok)" }}>{pc(s.survivedOfReal, s.realN)}</dd></div>
            </dl>
            <p className="tr-note mut">of the {s.realN.toLocaleString("en-US")} that raised real money ($300+)</p>
            <ul className="tr-legend">
              {OUT.map((o) => (
                <li key={o.k}><i style={{ background: o.color }} />{o.label}<b className="mono">{pc(s.counts[o.k], s.n)}</b></li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h2 style={{ fontSize: 16 }}>Latest grades</h2>
          <span className="mut" style={{ fontSize: 12 }}>Verdict as shown in New pairs · result 15 min after launch</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Token</th>
                <th>Verdict at launch</th>
                <th className="hide-m">Why</th>
                <th className="r">Peak raised</th>
                <th className="r hide-m">At 15 min</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {(d?.recent ?? []).map((r) => {
                const o = OUT.find((x) => x.k === r.outcome)!;
                return (
                  <tr key={r.mint}>
                    <td><Link href={`/token/${r.mint}`} className="mono"><b>{r.symbol}</b></Link></td>
                    <td><Pill v={r.verdict} /> <span className="mut mono" style={{ fontSize: 12 }}>at {r.verdictAtS}s</span></td>
                    <td className="hide-m mut tr-why">{r.reason.replace(/ · first look$/, "")}</td>
                    <td className="r mono">{usd(r.peakUsd)}</td>
                    <td className="r mono hide-m">{r.endUsd == null ? "–" : usd(r.endUsd)}</td>
                    <td><span className="tr-out" title={o.help}><i style={{ background: o.color }} />{o.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d && !d.recent.length && (
            <p className="empty">The first grades land 15 minutes after the first launches Vigil follows. {d.tracking} launches are being followed right now.</p>
          )}
        </div>
      </section>

      <section className="tr-how mut">
        <h2>How grading works</h2>
        <p>Only the first verdict shown in New pairs counts, usually 8 seconds after launch, before anyone knows how the token will do. Vigil then reads the token&apos;s bonding curve every 20 seconds and, at 15 minutes, compares the money in the curve with its peak.</p>
        <ul>
          {OUT.map((o) => <li key={o.k}><b>{o.label}</b>: {o.help}.</li>)}
        </ul>
        <p>A Bundled verdict is right when the token crashes. A Clean verdict is a fact about the launch, not a promise: a clean token can still go to zero. This is data, not financial advice. See the <Link href="/docs">Docs</Link> for what each verdict means.</p>
      </section>
    </>
  );
}
