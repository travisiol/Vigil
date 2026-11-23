"use client";
import { useEffect, useState } from "react";
import type { Market, Scan, ScanLite, Verdict } from "@/lib/types";

/** Filtres des listes (façon Axiom), dont des filtres tirés du scan. Gardés dans le navigateur. */
export type FilterState = {
  maxAgeMin: string;
  minMcap: string;
  maxMcap: string;
  minVol: string;
  verdicts: Record<Verdict | "none", boolean>;
  maxTop10: string;
  maxDev: string;
  maxEarly: string;
  scannedOnly: boolean;
  hideDead: boolean; // nouvelles paires : moins de 1 k$ réellement levés après 90 s
  minRaised: string; // $ réellement entrés dans la courbe
  hideSerial: boolean; // devs en série et fermes à devs
};

export const DEAD_AFTER_MS = 90_000;
export const DEAD_BELOW_USD = 1000;
export const isDead = (t: Market, now: number) =>
  t.raisedUsd != null && !!t.createdAt && now - t.createdAt > DEAD_AFTER_MS && t.raisedUsd < DEAD_BELOW_USD;
export const isSerial = (t: Market) => !!t.dev && (t.dev.launches24h >= 3 || t.dev.farm >= 2 || (t.dev.launches7d ?? 0) >= 10);

export const EMPTY: FilterState = {
  maxAgeMin: "",
  minMcap: "",
  maxMcap: "",
  minVol: "",
  verdicts: { clean: true, watch: true, bundled: true, none: true },
  maxTop10: "",
  maxDev: "",
  maxEarly: "",
  scannedOnly: false,
  hideDead: true,
  minRaised: "",
  hideSerial: true,
};

const n = (s: string) => (s.trim() === "" ? null : Number(s));

export function activeCount(f: FilterState) {
  return (
    [f.maxAgeMin, f.minMcap, f.maxMcap, f.minVol, f.maxTop10, f.maxDev, f.maxEarly, f.minRaised].filter((x) => x.trim() !== "").length +
    Object.values(f.verdicts).filter((v) => !v).length +
    (f.scannedOnly ? 1 : 0) +
    (f.hideSerial !== EMPTY.hideSerial ? 1 : 0)
  );
}

/** Vrai si la ligne passe les filtres. Les filtres du scan ne s'appliquent qu'aux tokens déjà scannés (sauf "scanned only"). */
export function passes(t: Market, s: Scan | ScanLite | null, f: FilterState, now: number) {
  if (f.hideDead && isDead(t, now)) return false;
  if (f.hideSerial && isSerial(t)) return false;
  const raised = n(f.minRaised);
  if (raised != null && t.raisedUsd != null && t.raisedUsd < raised) return false;
  const age = n(f.maxAgeMin);
  if (age != null && t.createdAt && now - t.createdAt > age * 60_000) return false;
  const lo = n(f.minMcap), hi = n(f.maxMcap), vol = n(f.minVol);
  if (lo != null && (t.mcap ?? 0) < lo) return false;
  if (hi != null && t.mcap != null && t.mcap > hi) return false;
  if (vol != null && (t.volume24h ?? 0) < vol) return false;
  if (!s) return !f.scannedOnly && f.verdicts.none;
  if (!f.verdicts[s.verdict]) return false;
  const top10 = n(f.maxTop10), dev = n(f.maxDev), early = n(f.maxEarly);
  if (top10 != null && s.signals.top10Pct != null && s.signals.top10Pct * 100 > top10) return false;
  if (dev != null && s.signals.dev.holdsPct != null && s.signals.dev.holdsPct * 100 > dev) return false;
  if (early != null && s.signals.early10s.pct != null && s.signals.early10s.pct * 100 > early) return false;
  return true;
}

export function useFilters(key: string) {
  const [f, setF] = useState<FilterState>(EMPTY);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setF({ ...EMPTY, ...JSON.parse(raw) });
    } catch {}
  }, [key]);
  const set = (next: FilterState) => {
    setF(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return [f, set] as const;
}

function Num({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return <input type="number" inputMode="decimal" min={0} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

export default function FilterPanel({ f, set }: { f: FilterState; set: (f: FilterState) => void }) {
  const up = (p: Partial<FilterState>) => set({ ...f, ...p });
  const labels: [Verdict | "none", string][] = [["clean", "Clean"], ["watch", "Watch"], ["bundled", "Bundled"], ["none", "Not scanned"]];
  return (
    <div className="filters">
      <fieldset>
        <legend>Scan verdict</legend>
        <div className="vchips">
          {labels.map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={f.verdicts[k]} onClick={() => up({ verdicts: { ...f.verdicts, [k]: !f.verdicts[k] } })}>{l}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Market cap ($)</legend>
        <div className="range"><Num value={f.minMcap} onChange={(v) => up({ minMcap: v })} placeholder="Min" label="Minimum market cap" /><span className="mut">–</span><Num value={f.maxMcap} onChange={(v) => up({ maxMcap: v })} placeholder="Max" label="Maximum market cap" /></div>
      </fieldset>
      <fieldset>
        <legend>Max age (minutes)</legend>
        <Num value={f.maxAgeMin} onChange={(v) => up({ maxAgeMin: v })} placeholder="Any" label="Maximum age in minutes" />
      </fieldset>
      <fieldset>
        <legend>Min volume 24h ($)</legend>
        <Num value={f.minVol} onChange={(v) => up({ minVol: v })} placeholder="Any" label="Minimum 24h volume" />
      </fieldset>
      <fieldset>
        <legend>Max taken in first 10 s (%)</legend>
        <Num value={f.maxEarly} onChange={(v) => up({ maxEarly: v })} placeholder="Any" label="Maximum supply taken in the first 10 seconds" />
      </fieldset>
      <fieldset>
        <legend>Max top 10 holders (%)</legend>
        <Num value={f.maxTop10} onChange={(v) => up({ maxTop10: v })} placeholder="Any" label="Maximum top 10 holders share" />
      </fieldset>
      <fieldset>
        <legend>Max dev holds (%)</legend>
        <Num value={f.maxDev} onChange={(v) => up({ maxDev: v })} placeholder="Any" label="Maximum dev holding" />
      </fieldset>
      <fieldset>
        <legend>Min raised on the curve ($)</legend>
        <Num value={f.minRaised} onChange={(v) => up({ minRaised: v })} placeholder="Any" label="Minimum real money raised" />
      </fieldset>
      <fieldset>
        <legend>Hide dead pairs (under $1K after 90 s)</legend>
        <div className="vchips"><button type="button" className="chip" aria-pressed={f.hideDead} onClick={() => up({ hideDead: !f.hideDead })}>{f.hideDead ? "On" : "Off"}</button></div>
      </fieldset>
      <fieldset>
        <legend>Hide serial devs & dev farms</legend>
        <div className="vchips"><button type="button" className="chip" aria-pressed={f.hideSerial} onClick={() => up({ hideSerial: !f.hideSerial })}>{f.hideSerial ? "On" : "Off"}</button></div>
      </fieldset>
      <fieldset>
        <legend>Only scanned tokens</legend>
        <div className="vchips"><button type="button" className="chip" aria-pressed={f.scannedOnly} onClick={() => up({ scannedOnly: !f.scannedOnly })}>{f.scannedOnly ? "On" : "Off"}</button></div>
      </fieldset>
      <div className="foot">
        <span className="mut" style={{ fontSize: 12 }}>Scan filters apply once a token is scanned. Saved on this device.</span>
        <button type="button" className="chip" onClick={() => set(EMPTY)}>Reset</button>
      </div>
    </div>
  );
}
