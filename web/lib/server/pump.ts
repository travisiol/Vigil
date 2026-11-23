import "server-only";
import { PublicKey } from "@solana/web3.js";
import type { Market } from "../types";
import { markets } from "./dex";
import { apiSlot, cached, rpc, RPC_URL } from "./rpc";

/**
 * Données de marché d'un token pump.fun encore inconnu de DexScreener (les premières minutes) :
 * nom / symbole / logo via Helius, prix / market cap / progression lus directement sur la bonding curve.
 */
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const INITIAL_REAL_TOKENS = 793_100_000_000_000;

export const solUsd = () => cached("solusd", 60_000, () => markets([SOL_MINT]).then((m) => m.get(SOL_MINT)?.priceUsd ?? null)).catch(() => null);

/**
 * Lecture d'une bonding curve pump.fun. pump.fun accepte maintenant d'autres monnaies de cotation que le SOL
 * (ex. NVDAx, une action tokenisée) : le mint de cotation est à l'octet 83 (vide = SOL).
 */
export type CurveData = { vTok: number; vQuote: number; realTok: number; realQuote: number; supply: number; complete: boolean; quoteMint: string };
export function decodeCurve(d: Buffer): CurveData | null {
  if (d.length < 49) return null;
  let quoteMint = SOL_MINT;
  if (d.length >= 115) {
    const q = d.subarray(83, 115);
    if (q.some((b) => b !== 0)) quoteMint = new PublicKey(q).toBase58();
  }
  return {
    vTok: Number(d.readBigUInt64LE(8)),
    vQuote: Number(d.readBigUInt64LE(16)),
    realTok: Number(d.readBigUInt64LE(24)),
    realQuote: Number(d.readBigUInt64LE(32)),
    supply: Number(d.readBigUInt64LE(40)),
    complete: d[48] === 1,
    quoteMint,
  };
}

/** Décimales et prix en $ de la monnaie de cotation (SOL dans la plupart des cas). */
/**
 * Décimales et prix en $ d'une monnaie de cotation.
 * Prix : Jupiter Price (agrégé sur la liquidité réelle) ; DexScreener seulement en secours, car un seul pool cassé
 * peut y afficher un prix absurde (mesuré : ZEC à 8,6 M$ au lieu de ~860 $).
 */
export function quoteInfo(mint: string): Promise<{ decimals: number; usd: number | null }> {
  if (mint === SOL_MINT) return solUsd().then((usd) => ({ decimals: 9, usd }));
  return cached(`quote:${mint}`, 60_000, async () => {
    const jup = await jupPrice(mint).catch(() => null);
    if (jup?.usd != null && jup.decimals != null) return { decimals: jup.decimals, usd: jup.usd };
    const [acc, m] = await Promise.all([
      rpc().getParsedAccountInfo(new PublicKey(mint)).catch(() => null),
      markets([mint]).catch(() => new Map()),
    ]);
    const decimals = jup?.decimals ?? ((acc?.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed?.info?.decimals) ?? 6;
    return { decimals, usd: jup?.usd ?? m.get(mint)?.priceUsd ?? null };
  });
}

async function jupPrice(mint: string): Promise<{ usd: number | null; decimals: number | null } | null> {
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  const j = (await r.json()) as Record<string, { usdPrice?: number; decimals?: number }>;
  const x = j[mint];
  return x ? { usd: typeof x.usdPrice === "number" ? x.usdPrice : null, decimals: typeof x.decimals === "number" ? x.decimals : null } : null;
}

/** Prix, market cap, progression et argent levé, en $, quelle que soit la monnaie de cotation. */
export async function curveStats(c: CurveData) {
  const q = { ...(await quoteInfo(c.quoteMint)) };
  if (c.vTok <= 0) return null;
  const priceQuote = c.vQuote / 10 ** q.decimals / (c.vTok / 1e6);
  // Garde-fou : avant la migration, une courbe lève au plus ~85 k$. Au-delà, le prix de la monnaie de cotation est faux.
  const raised = q.usd != null ? (c.realQuote / 10 ** q.decimals) * q.usd : null;
  if (raised != null && !c.complete && raised > 150_000) q.usd = null;
  return {
    priceUsd: q.usd != null ? priceQuote * q.usd : null,
    mcapUsd: q.usd != null ? priceQuote * (c.supply / 1e6) * q.usd : null,
    raisedUsd: q.usd != null ? (c.realQuote / 10 ** q.decimals) * q.usd : null,
    pct: c.complete ? 1 : Math.max(0, Math.min(1, (INITIAL_REAL_TOKENS - c.realTok) / INITIAL_REAL_TOKENS)),
    // Part du supply déjà achetée sur la courbe (supply de référence : 1 milliard ; en mode Mayhem, le 2e milliard de l'agent est exclu)
    soldShare: Math.max(0, Math.min(1, (INITIAL_REAL_TOKENS - c.realTok) / Math.min(c.supply || 1e15, 1e15))),
    quoteMint: c.quoteMint,
  };
}

export const curvePda = (mint: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0];

/**
 * Adresse dont on lit l'historique des trades.
 * Token encore sur la bonding curve : l'adresse de la courbe. Seuls les vrais achats / ventes la touchent,
 * alors que l'adresse du token est noyée sous des transactions de bots qui la citent sans rien échanger
 * (mesuré : 85 transactions sur 100 sans aucun transfert). Token migré ou hors pump.fun : le token lui-même.
 */
/** Compte de la bonding curve pump.fun d'un token (null si le token n'en a pas). Lu au plus toutes les 2 s. */
export function readCurve(mint: string): Promise<CurveData | null> {
  return cached(`curve:${mint}`, 2_000, async () => {
    const info = await rpc().getAccountInfo(curvePda(mint)).catch(() => null);
    return info && info.owner.equals(PUMP_PROGRAM) ? decodeCurve(info.data) : null;
  });
}

/** Le token est-il (ou a-t-il été) un lancement pump.fun ? Vrai s'il a une bonding curve, quel que soit le suffixe de son adresse. */
export function isPumpToken(mint: string): Promise<boolean> {
  if (mint.endsWith("pump")) return Promise.resolve(true);
  return cached(`ispump:${mint}`, 3_600_000, () => readCurve(mint).then((c) => c != null).catch(() => false));
}

export function tradeAddress(mint: string): Promise<{ address: string; curve: string | null }> {
  return cached(`tradeaddr:${mint}`, 30_000, async () => {
    const c = await readCurve(mint);
    if (!c || c.complete) return { address: mint, curve: null };
    const curve = curvePda(mint).toBase58();
    return { address: curve, curve };
  });
}

type Asset = { content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string }; files?: { uri?: string; cdn_uri?: string }[] } };

async function asset(mint: string): Promise<Asset | null> {
  if (!RPC_URL.includes("helius")) return null;
  await apiSlot();
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "vigil", method: "getAsset", params: { id: mint } }),
    cache: "no-store",
  });
  if (!r.ok) return null;
  return ((await r.json()) as { result?: Asset }).result ?? null;
}

export function pumpMarket(mint: string): Promise<Market | null> {
  return cached(`pumpmkt:${mint}`, 8_000, async () => {
    const [a, info] = await Promise.all([asset(mint).catch(() => null), rpc().getAccountInfo(curvePda(mint)).catch(() => null)]);
    if (!a && !info) return null;
    const c = info ? decodeCurve(info.data) : null;
    const st = c ? await curveStats(c).catch(() => null) : null;
    const priceUsd = st?.priceUsd ?? null, mcap = st?.mcapUsd ?? null, curvePct = st?.pct ?? null, raisedUsd = st?.raisedUsd ?? null;
    const meta = a?.content?.metadata;
    return {
      mint,
      symbol: meta?.symbol?.trim() || mint.slice(0, 4),
      name: meta?.name?.trim() || "New token",
      image: a?.content?.files?.[0]?.cdn_uri || a?.content?.links?.image || a?.content?.files?.[0]?.uri || null,
      priceUsd,
      mcap,
      liquidity: null,
      change1h: null,
      change24h: null,
      volume24h: null,
      pairAddress: null,
      dexId: "pumpfun",
      createdAt: null,
      curvePct,
      raisedUsd,
    };
  });
}
