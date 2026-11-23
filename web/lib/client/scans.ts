"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { Scan } from "../types";

/**
 * File de scans partagée entre les pages, en 2 vitesses :
 * - quick : verdict en quelques secondes (lancement, holders, dev)
 * - full : + traçage des financements, demandé seulement pour les tokens qui passent l'entonnoir (ou ouverts)
 * Un scan rapide reste affiché pendant que le complet tourne.
 */
type Depth = "quick" | "full";
type Entry = Scan | "error" | "pending";
const results = new Map<string, Entry>();
const upgrading = new Set<string>(); // scan complet en cours alors qu'un rapide est affiché
const queue: { mint: string; depth: Depth }[] = [];
const listeners = new Set<() => void>();
let running = 0;
let version = 0;
const CONCURRENCY = 3;

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

const inflight = new Map<AbortController, { mint: string; depth: Depth }>();
let heldUntil = 0;

function pump() {
  if (Date.now() < heldUntil) return;
  while (running < CONCURRENCY && queue.length) {
    const job = queue.pop()!; // le dernier demandé d'abord : les nouveautés passent devant
    const { mint, depth } = job;
    const ctrl = new AbortController();
    inflight.set(ctrl, job);
    running++;
    fetch(`/api/scan/${mint}${depth === "quick" ? "?depth=quick" : ""}`, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as Scan) : "error"))
      .catch(() => "error" as const)
      .then((res) => {
        inflight.delete(ctrl);
        running--;
        if (ctrl.signal.aborted) return; // mis de côté par holdScans : déjà remis dans la file
        const cur = results.get(mint);
        // un échec du scan complet ne doit pas effacer un scan rapide réussi
        if (!(res === "error" && cur && typeof cur === "object")) results.set(mint, res);
        if (depth === "full") upgrading.delete(mint);
        emit();
        pump();
      });
  }
}

/**
 * Libère le réseau du navigateur (6 connexions max par site) pendant l'ouverture d'un token :
 * les scans de la liste en cours sont suspendus puis relancés après `ms`.
 */
export function holdScans(ms = 4000) {
  heldUntil = Date.now() + ms;
  for (const [ctrl, job] of inflight) {
    queue.push(job);
    ctrl.abort();
  }
  setTimeout(pump, ms + 50);
}

export function requestScan(mint: string, depth: Depth = "full") {
  const cur = results.get(mint);
  if (cur === "pending" || cur === "error") return;
  if (cur && typeof cur === "object") {
    if (depth === "quick" || cur.depth === "full" || upgrading.has(mint)) return;
    upgrading.add(mint);
  } else results.set(mint, "pending");
  queue.push({ mint, depth });
  pump();
}

export function setScan(s: Scan) {
  results.set(s.mint, s);
  emit();
}

export const isUpgrading = (mint: string) => upgrading.has(mint);

/** quick : mints à scanner vite · full : mints à scanner en entier. */
export function useScans(quick: string[], full: string[] = []) {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  const key = quick.join(",") + "|" + full.join(",");
  useEffect(() => {
    // le haut de la liste est servi en premier (file LIFO)
    [...quick].reverse().forEach((m) => requestScan(m, "quick"));
    [...full].reverse().forEach((m) => requestScan(m, "full"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (mint: string): Entry | undefined => results.get(mint);
}
