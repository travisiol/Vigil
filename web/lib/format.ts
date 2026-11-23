export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `$${n.toFixed(2)}`;
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** Prix lisibles même minuscules : 0.00003045 → $0.0₄3045 (notation des terminaux pros). */
export function price(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n >= 1) return `$${n.toFixed(n >= 1000 ? 0 : 4)}`;
  if (n <= 0) return "$0"; // l'axe du graphique peut descendre à 0 ou en dessous
  if (n >= 0.001) return `$${n.toFixed(5)}`;
  const zeros = -Math.floor(Math.log10(n)) - 1;
  const digits = Math.round(n * 10 ** (zeros + 4)).toString().slice(0, 4);
  return `$0.0${String(zeros).split("").map((d) => SUB[+d]).join("")}${digits}`;
}

export function pct(n: number | null | undefined, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;
}

export function share(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const v = x * 100;
  return `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

export function age(ms: number | null | undefined): string {
  if (!ms) return "–";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** "1.5" SOL → lamports en string, sans erreur d'arrondi. */
export function toRaw(ui: string, decimals: number): string {
  const [i, f = ""] = ui.trim().replace(",", ".").split(".");
  if (!/^\d*$/.test(i) || !/^\d*$/.test(f)) return "0";
  return (BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

export function fromRaw(raw: string | bigint, decimals: number, maxFrac = 4): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const i = v / base;
  const f = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${i.toLocaleString("en-US")}${f ? "." + f : ""}`;
}
