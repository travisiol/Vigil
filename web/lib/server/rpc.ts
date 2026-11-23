import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Connection } from "@solana/web3.js";

export const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/**
 * Régulateur : toutes les requêtes RPC passent sous une limite par seconde
 * (plan gratuit Helius ≈ 10/s ; réglable avec RPC_RPS quand on passe à un plan payant).
 */
const RPS = Number(process.env.RPC_RPS) || (RPC_URL.includes("helius") ? 5 : 3); // 6/s donnait des 429 (chacun coûte ≥ 0,5 s de retry)
let stamps: number[] = [];
// 3 files : 0 = flux des nouvelles paires, 1 = scans demandés par un utilisateur, 2 = travail de fond (mémoire des devs)
type Level = 0 | 1 | 2;
const queues: (() => void)[][] = [[], [], []];
const lastServed = [0, 0, 0];
let timer: ReturnType<typeof setTimeout> | null = null;
const waiting = () => queues[0].length + queues[1].length + queues[2].length;
function drain() {
  timer = null;
  const now = Date.now();
  stamps = stamps.filter((t) => now - t < 1000);
  while (waiting() && stamps.length < RPS) {
    stamps.push(now);
    // Priorité, mais jamais de famine (F-076) : avant, la file de fond n'était JAMAIS servie dès que le trafic était continu
    // (bulletin des verdicts à 0, scans automatiques du flux jamais faits, mémoire des devs bloquée).
    // Chaque file a sa part minimale : fond ≥ 1 requête / 0,8 s, utilisateurs ≥ 1 / 0,4 s, le reste par priorité.
    const lvl: Level =
      queues[2].length && now - lastServed[2] > 800 ? 2
      : queues[1].length && now - lastServed[1] > 400 ? 1
      : queues[0].length ? 0
      : queues[1].length ? 1
      : 2;
    lastServed[lvl] = now;
    queues[lvl].shift()!();
  }
  if (waiting()) timer = setTimeout(drain, 1000 - (now - stamps[0]) + 5);
}
export function rpcSlot(level: Level | boolean = 1): Promise<void> {
  const l: Level = level === true ? 0 : level === false ? 1 : level;
  return new Promise((resolve) => {
    queues[l].push(resolve);
    if (!timer) drain();
  });
}
// Un lot JSON-RPC de N appels compte pour N requêtes chez Helius : on prend N places.
const throttledFetch = (level: Level): typeof fetch => async (input, init) => {
  const body = typeof init?.body === "string" ? init.body : "";
  const n = body.startsWith("[") ? Math.max(1, (body.match(/"jsonrpc"/g) ?? []).length) : 1;
  for (let i = 0; i < n; i++) await rpcSlot(level);
  return fetch(input, init);
};

const conns: (Connection | null)[] = [null, null, null];
const at = (l: Level) => (conns[l] ??= new Connection(RPC_URL, { commitment: "confirmed", fetch: throttledFetch(l) }));
// Priorité portée par le contexte : un scan lancé par le flux automatique passe derrière ceux qu'un utilisateur ouvre
const prio = new AsyncLocalStorage<Level>();
export const withPriority = <T>(level: Level, fn: () => Promise<T>): Promise<T> => prio.run(level, fn);
/** Priorité du contexte en cours (2 = travail de fond). */
export const currentPriority = (): Level => prio.getStore() ?? 1;
/** Scans et actions des utilisateurs (ou la priorité du contexte en cours). */
export const rpc = (): Connection => at(prio.getStore() ?? 1);
/** Flux des nouvelles paires : passe devant tout. */
export const rpcPriority = (): Connection => at(0);
/** Travail de fond : passe après tout le reste. */
export const rpcLow = (): Connection => at(2);

/**
 * Les API Helius "enrichies" (DAS, transactions décodées) ont leur propre limite, plus basse (≈ 2/s en gratuit).
 * File séparée, sinon elles répondent "trop de requêtes" et on retombe sur la méthode lente.
 */
const API_RPS = Number(process.env.HELIUS_API_RPS) || 2;
let apiStamps: number[] = [];
const apiHi: (() => void)[] = []; // ce qu'un utilisateur attend (FIFO : premier arrivé, premier servi)
const apiLo: (() => void)[] = []; // fond (historique des bougies, traçages automatiques)
let apiLoServed = 0;
let apiTimer: ReturnType<typeof setTimeout> | null = null;
function apiDrain() {
  apiTimer = null;
  const now = Date.now();
  apiStamps = apiStamps.filter((t) => now - t < 1000);
  while ((apiHi.length || apiLo.length) && apiStamps.length < API_RPS) {
    apiStamps.push(now);
    // Le fond garde au moins 1 requête toutes les 1,5 s (sinon jamais servi quand des pages sont ouvertes)
    if (apiLo.length && (!apiHi.length || now - apiLoServed > 1500)) {
      apiLoServed = now;
      apiLo.shift()!();
    } else apiHi.shift()!();
  }
  if (apiHi.length || apiLo.length) apiTimer = setTimeout(apiDrain, 1000 - (now - apiStamps[0]) + 5);
}
export function apiSlot(priority = false): Promise<void> {
  return new Promise((resolve) => {
    (priority ? apiHi : apiLo).push(resolve);
    if (!apiTimer) apiDrain();
  });
}

/**
 * Lit plusieurs transactions en requêtes simples parallèles (le plan gratuit Helius refuse les lots JSON-RPC).
 * Chaque requête passe par le régulateur de la connexion utilisée.
 */
export function getTxs(conn: Connection, sigs: string[]) {
  return Promise.all(sigs.map((s) => conn.getParsedTransaction(s, { maxSupportedTransactionVersion: 1 as 0 }).catch(() => null)));
}

/** Cache mémoire avec TTL, qui partage aussi les requêtes en cours. */
const store = new Map<string, { t: number; p: Promise<unknown> }>();
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p as Promise<T>;
  const p = fn().catch((e) => {
    store.delete(key);
    throw e;
  });
  store.set(key, { t: Date.now(), p });
  if (store.size > 3000) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
  return p;
}

/** Erreur dont le message peut être montré tel quel à l'utilisateur. */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Vigil lost the signal. Retry." }, { status: 502 });
}

export function isMint(s: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}
