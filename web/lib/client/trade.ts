"use client";
import { VersionedTransaction } from "@solana/web3.js";
import type { SwapQuote } from "../types";

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "Vigil lost the signal. Retry." }));
  if (!r.ok) throw new Error(j.error || "Vigil lost the signal. Retry.");
  return j as T;
}

export type TradeRequest = { side: "buy" | "sell"; mint: string; amount: string; taker: string; slippageBps: number };

/** Étape 1 : le serveur construit la transaction (swap + fee) et la simule. */
export function quote(req: TradeRequest) {
  return post<SwapQuote>("/api/swap", req);
}

/** Étape 2 : le wallet de l'utilisateur signe, puis Vigil envoie et attend la confirmation. */
export async function signAndSend(q: SwapQuote, signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>) {
  const tx = VersionedTransaction.deserialize(b64ToBytes(q.tx));
  const signed = await signTransaction(tx);
  return post<{ signature: string; status: "confirmed" | "failed" | "pending" }>("/api/send", { tx: bytesToB64(signed.serialize()) });
}
