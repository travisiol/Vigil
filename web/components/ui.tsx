import { brand } from "@/brand.config";
import type { Verdict } from "@/lib/types";

export function VMark({ className, id = "vg" }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 100 84" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9232F1" />
          <stop offset=".55" stopColor="#BC33C9" />
          <stop offset="1" stopColor="#F22C7B" />
        </linearGradient>
      </defs>
      <path d="M0 0 L50 84 L100 0 C80 9 60 27 50 50 C40 27 20 9 0 0 Z" fill={`url(#${id})`} />
    </svg>
  );
}

const glyph: Record<string, React.ReactNode> = {
  clean: <path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  watch: <path d="M6 1.5 11 10.5H1z" fill="currentColor" />,
  bundled: <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  scanning: (
    <>
      <circle cx="6" cy="6" r="2.6" fill="currentColor" />
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".45" />
    </>
  ),
  unknown: <circle cx="6" cy="6" r="2" fill="currentColor" />,
};

export function Pill({ v, title }: { v: Verdict | "scanning" | "unknown"; title?: string }) {
  const label = v === "unknown" ? "No data" : brand.copy.scanLabels[v];
  return (
    <span className={`pill p-${v}`} title={title}>
      <svg viewBox="0 0 12 12">{glyph[v]}</svg>
      {label}
    </span>
  );
}

export { default as TokenIcon } from "./TokenIcon";
