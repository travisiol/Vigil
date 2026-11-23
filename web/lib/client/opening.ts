"use client";
import { useSyncExternalStore } from "react";
import type { Verdict } from "../types";

/**
 * Écran de transition entre le clic sur un token et sa page prête.
 * Il s'affiche au clic même (avant toute réponse réseau) et suit les vraies étapes :
 * page ouverte → verdict connu → graphique chargé. Il se ferme quand le graphique est là.
 */
export type Opening = {
  mint: string;
  symbol: string | null;
  name: string | null;
  image: string | null;
  t0: number;
  page: boolean;
  verdict: Verdict | null;
  chart: boolean;
  closing: boolean;
};

let cur: Opening | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;

const MIN_MS = 650; // assez long pour voir l'animation, jamais un flash
const MAX_MS = 7000; // filet de sécurité : la page s'affiche quoi qu'il arrive

export function startOpening(o: { mint: string; symbol?: string | null; name?: string | null; image?: string | null; verdict?: Verdict | null }) {
  clearTimeout(closeTimer);
  clearTimeout(safetyTimer);
  cur = { mint: o.mint, symbol: o.symbol ?? null, name: o.name ?? null, image: o.image ?? null, t0: Date.now(), page: false, verdict: o.verdict ?? null, chart: false, closing: false };
  safetyTimer = setTimeout(() => close(o.mint), MAX_MS);
  emit();
}

function close(mint: string) {
  if (!cur || cur.mint !== mint || cur.closing) return;
  cur = { ...cur, closing: true };
  emit();
  closeTimer = setTimeout(() => {
    if (cur?.mint === mint) {
      cur = null;
      emit();
    }
  }, 380); // durée du fondu
}

export function markOpening(mint: string, patch: Partial<Pick<Opening, "page" | "verdict" | "chart" | "symbol" | "name" | "image">>) {
  if (!cur || cur.mint !== mint || cur.closing) return;
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) if (v != null && v !== false && !(next as Record<string, unknown>)[k]) (next as Record<string, unknown>)[k] = v;
  cur = next;
  emit();
  if (patch.chart) setTimeout(() => close(mint), Math.max(0, MIN_MS - (Date.now() - cur.t0)));
}

/** Ferme sans attendre (navigation annulée, autre page). */
export function cancelOpening() {
  if (cur) close(cur.mint);
}

export function useOpening(): Opening | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cur,
    () => null,
  );
}
