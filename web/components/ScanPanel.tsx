"use client";
import { useEffect, useState } from "react";
import { brand } from "@/brand.config";
import { share, short } from "@/lib/format";
import type { Scan, ScanLite } from "@/lib/types";
import { Pill } from "./ui";

function Meter({ label, value, bad, warn, fill }: { label: string; value: string; bad?: boolean; warn?: boolean; fill: number | null }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(fill == null ? 0 : Math.max(1, Math.min(100, fill * 100))), 60);
    return () => clearTimeout(t);
  }, [fill]);
  return (
    <div className="meter">
      <div className="t"><span>{label}</span><b>{value}</b></div>
      <div className="track"><span className={bad ? "r" : warn ? "w" : undefined} style={{ width: `${w}%` }} /></div>
    </div>
  );
}

export default function ScanPanel({ scan, early }: { scan: Scan | null; early?: ScanLite | null }) {
  if (!scan)
    return (
      <section className="card scanp beam">
        {early ? (
          // Verdict déjà connu du flux (premier regard / mémoire du dev), affiché pendant que le scan détaillé tourne
          <div className="verdict-row">
            <Pill v={early.verdict} />
            <p>{early.reason[0].toUpperCase() + early.reason.slice(1)}.</p>
            <span className="mut" style={{ fontSize: 12 }}>details loading…</span>
          </div>
        ) : (
          <div className="verdict-row"><Pill v="scanning" /><p className="mut">Vigil is reading this token&apos;s launch, holders and dev…</p></div>
        )}
      </section>
    );
  const s = scan.signals;
  const t = brand.scan;
  return (
    <section className="card scanp" aria-label="Vigil scan">
      <div className="verdict-row">
        <Pill v={scan.verdict} />
        <p>{scan.reason[0].toUpperCase() + scan.reason.slice(1)}.</p>
        <span className="mut mono" style={{ fontSize: 12 }}>checked {new Date(scan.checkedAt).toLocaleTimeString()}</span>
      </div>
      <div className="meters">
        <Meter
          label="Supply taken in the first 10 s"
          value={s.early10s.traced ? `${share(s.early10s.pct)} · ${s.early10s.wallets} wallets${s.early10s.snipers ? ` · ${s.early10s.snipers} bots` : ""}` : "not measured"}
          fill={s.early10s.pct}
          bad={(s.early10s.pct ?? 0) >= t.early10sBundled}
        />
        <Meter label="Biggest wallet (pools excluded)" value={s.topWallet ? share(s.topWallet.pct) : s.holdersMeasured ? "–" : "not measured"} fill={s.topWallet?.pct ?? null} bad={(s.topWallet?.pct ?? 0) >= t.topWalletBundled} />
        <Meter label="Top 10 wallets" value={s.holdersMeasured ? share(s.top10Pct) : "not measured"} fill={s.top10Pct} warn={(s.top10Pct ?? 0) >= t.top10Watch} />
        <Meter
          label="Dev still holds"
          value={s.dev.holdsPct == null ? "unknown" : `${share(s.dev.holdsPct)}${s.dev.sold ? " · sold" : ""}`}
          fill={s.dev.holdsPct}
          warn={!!s.dev.sold}
        />
        <Meter
          label="Liquidity vs market cap"
          value={s.liquidityToMcap == null ? (scan.market?.dexId === "pumpfun" ? "on the pump.fun curve" : "–") : share(s.liquidityToMcap)}
          fill={s.liquidityToMcap == null ? null : Math.min(1, s.liquidityToMcap * 5)}
          warn={s.liquidityToMcap != null && s.liquidityToMcap < t.liquidityWatch}
        />
      </div>
      <div className="facts">
        <Pill v={s.mintAuthority ? "watch" : "clean"} title="Can new tokens be created?" />
        <span className="mut" style={{ fontSize: 13, alignSelf: "center" }}>{s.mintAuthority ? "Mint authority active" : "Mint authority revoked"}</span>
        <Pill v={s.freezeAuthority ? "watch" : "clean"} title="Can tokens be frozen?" />
        <span className="mut" style={{ fontSize: 13, alignSelf: "center" }}>{s.freezeAuthority ? "Freeze authority active" : "Freeze authority revoked"}</span>
      </div>
      {s.gmgn && (
        <div className="clusters">
          <div className="cl-h">
            <b>Wallet intel</b>
            <span className="mut">dev history and wallet tags · data: GMGN</span>
          </div>
          <div className={`cl ${(s.gmgn.devLaunches ?? 0) >= 20 ? "bad" : (s.gmgn.devLaunches ?? 0) >= 5 ? "warn" : ""}`}>
            <span>Tokens this dev has launched</span>
            <span className="mono">{s.gmgn.devLaunches ?? "–"}</span>
            <span className="mut">{s.gmgn.devStatus === "sold" ? "dev already sold everything" : s.gmgn.devStatus === "hold" ? "dev still holds" : ""}</span>
          </div>
          <div className={`cl ${(s.gmgn.bundlerPct ?? 0) >= 0.2 ? "bad" : (s.gmgn.bundlerPct ?? 0) >= 0.1 ? "warn" : ""}`}>
            <span>Held by bundlers</span>
            <span className="mono">{share(s.gmgn.bundlerPct)}</span>
            <span className="mut">{s.gmgn.bundlerWallets != null ? `${s.gmgn.bundlerWallets} bundler wallets` : ""}</span>
          </div>
          <div className={`cl ${(s.gmgn.insiderPct ?? 0) >= 0.2 ? "bad" : (s.gmgn.insiderPct ?? 0) >= 0.1 ? "warn" : ""}`}>
            <span>Held by insiders</span>
            <span className="mono">{share(s.gmgn.insiderPct)}</span>
            <span className="mut">{s.gmgn.sniperCount != null ? `${s.gmgn.sniperCount} snipers` : ""}</span>
          </div>
          <div className={`cl ${(s.gmgn.ratPct ?? 0) >= 0.2 ? "warn" : ""}`}>
            <span>Held by rat traders</span>
            <span className="mono">{share(s.gmgn.ratPct)}</span>
            <span className="mut">
              {s.gmgn.socials.x && <a href={s.gmgn.socials.x} target="_blank" rel="noreferrer">X</a>}
              {s.gmgn.socials.x && s.gmgn.socials.website && " · "}
              {s.gmgn.socials.website && <a href={s.gmgn.socials.website} target="_blank" rel="noreferrer">website</a>}
              {!s.gmgn.socials.x && !s.gmgn.socials.website && "no socials"}
            </span>
          </div>
        </div>
      )}
      {s.devMemory && (
        <div className="clusters">
          <div className="cl-h">
            <b>Dev memory</b>
            <span className="mut">every pump.fun launch Vigil has seen{s.devMemory.watchingSince ? ` since ${new Date(s.devMemory.watchingSince).toLocaleTimeString()}` : ""}</span>
          </div>
          <div className={`cl ${s.devMemory.launches24h >= 3 ? "bad" : s.devMemory.launches24h === 2 ? "warn" : ""}`}>
            <span>Launches by this dev (24 h)</span>
            <span className="mono">{s.devMemory.launches24h || "–"}</span>
            <span className="mut">{s.devMemory.launches24h >= 3 ? "serial launcher" : "no pattern"}</span>
          </div>
          <div className={`cl ${(s.devMemory.launches7d ?? 0) >= 10 ? "bad" : (s.devMemory.launches7d ?? 0) >= 4 ? "warn" : ""}`}>
            <span>Launches by this dev (7 days)</span>
            <span className="mono">{s.devMemory.launches7d || "–"}</span>
            <span className="mut">{(s.devMemory.launches7d ?? 0) >= 10 ? "serial launcher" : "no pattern"}</span>
          </div>
          <div className={`cl ${s.devMemory.farm >= 2 ? "bad" : s.devMemory.farm === 1 ? "warn" : ""}`}>
            <span>Other devs funded by the same wallet</span>
            <span className="mono">{s.devMemory.traced ? s.devMemory.farm : "…"}</span>
            <span className="mut">{s.devMemory.funder ? <>funder <a href={`https://solscan.io/account/${s.devMemory.funder}`} target="_blank" rel="noreferrer">{short(s.devMemory.funder)}</a></> : s.devMemory.traced ? "funded by an exchange or an old wallet" : "tracing…"}</span>
          </div>
          <div className={`cl ${s.devMemory.fresh ? "warn" : ""}`}>
            <span>Dev wallet age</span>
            <span className="mono">{s.devMemory.fresh == null ? "…" : s.devMemory.fresh ? "< 1 h" : "older"}</span>
            <span className="mut">{s.devMemory.fresh == null ? "tracing…" : s.devMemory.fresh ? "made just before launch" : "not a throwaway"}</span>
          </div>
        </div>
      )}
      <div className="clusters">
        <div className="cl-h">
          <b>Funding clusters</b>
          <span className="mut">{s.walletsTraced} wallets traced back to who sent them their first SOL</span>
        </div>
        {s.clusters.length ? (
          s.clusters.slice(0, 4).map((c) => (
            <div key={c.funder} className={`cl ${c.devLinked || c.pct >= 0.1 ? "bad" : c.pct >= 0.05 ? "warn" : ""}`}>
              <span className="mono">
                {c.wallets} wallets ← <a href={`https://solscan.io/account/${c.funder}`} target="_blank" rel="noreferrer">{short(c.funder)}</a>
              </span>
              <span className="mono">{share(c.pct)} of supply</span>
              <span className="mut">
                {c.devLinked ? "linked to the dev" : c.fresh >= 0.5 ? "fresh wallets, made just before launch" : "same funder"}
              </span>
            </div>
          ))
        ) : (
          <div className="cl ok"><span>No group of buyers shares a funder. Exchanges and big hubs are ignored.</span></div>
        )}
      </div>
      {scan.reasons.length > 1 && (
        <div className="reasons">
          {scan.reasons.map((r) => (
            <div key={r.text}><Pill v={r.level} /><span>{r.text}</span></div>
          ))}
        </div>
      )}
      <p className="note">
        {s.dev.address && <>Dev wallet <a className="mono" href={`https://solscan.io/account/${s.dev.address}`} target="_blank" rel="noreferrer">{short(s.dev.address)}</a> · </>}
        {s.poolsExcluded} pool accounts excluded · Facts from the chain, not financial advice.
        {!s.early10s.traced && " This token has too much history to trace its launch live yet."}
      </p>
    </section>
  );
}
