"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cancelOpening, useOpening } from "@/lib/client/opening";
import { short } from "@/lib/format";
import { TokenIcon } from "./ui";

const VERDICT_LABEL = { clean: "Clean", watch: "Watch", bundled: "Bundled" } as const;

/** Transition stylée entre le clic sur un token et sa page prête (étapes réelles, pas une barre factice). */
export default function OpeningOverlay() {
  const o = useOpening();
  const path = usePathname();

  // Si l'utilisateur part ailleurs (autre onglet du terminal), on ferme
  useEffect(() => {
    if (o && !o.closing && !path.startsWith("/token/") && Date.now() - o.t0 > 1500) cancelOpening();
  }, [o, path]);

  if (!o) return null;
  const sym = o.symbol ? `$${o.symbol.replace(/^\$+/, "")}` : short(o.mint);
  const steps: { key: string; label: string; done: boolean; extra?: React.ReactNode }[] = [
    { key: "page", label: "Opening the token", done: o.page },
    {
      key: "verdict",
      label: "Vigil verdict",
      done: !!o.verdict,
      extra: o.verdict ? <b className={`ov-v v-${o.verdict}`}>{VERDICT_LABEL[o.verdict]}</b> : null,
    },
    { key: "chart", label: "TradingView chart · 1s candles", done: o.chart },
  ];
  const active = steps.findIndex((s) => !s.done);
  const progress = steps.filter((s) => s.done).length / steps.length;

  return (
    <div className={`ov ${o.closing ? "ov-out" : ""}`} role="status" aria-live="polite" aria-label={`Opening ${sym}`}>
      <div className="ov-card">
        <div className="ov-eye">
          <span className="ov-ring" aria-hidden="true" />
          <span className="ov-ring ov-ring2" aria-hidden="true" />
          <TokenIcon src={o.image} alt="" symbol={o.symbol ?? undefined} />
        </div>
        <h2>{sym}</h2>
        {o.name && <p className="mut ov-name">{o.name}</p>}
        <ol className="ov-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={s.done ? "done" : i === active ? "now" : ""}>
              <i aria-hidden="true" />
              <span>{s.label}</span>
              {s.extra}
            </li>
          ))}
        </ol>
        <div className="ov-bar" aria-hidden="true"><i style={{ transform: `scaleX(${0.08 + progress * 0.92})` }} /></div>
      </div>
    </div>
  );
}
