import "server-only";
import { randomUUID } from "node:crypto";
import type { GmgnSignals } from "../types";
import { currentPriority } from "./rpc";

/**
 * Client de l'Open API GMGN (format relevé dans leur outil officiel gmgn-cli : openapi.gmgn.ai, en-tête X-APIKEY,
 * + timestamp et client_id à chaque requête). Couche rapide du scan : ~0,3 s par appel, historique complet des devs.
 * Plan gratuit : 5 "points" par fenêtre ; info = 1 point, security = 1 point (top holders = 5 : non utilisé).
 * Si la clé manque ou si GMGN ne répond pas, le scan continue avec notre moteur seul.
 */
const HOST = "https://openapi.gmgn.ai";

// Cache qui ne garde que les vraies réponses : un "pas de réponse" (pause GMGN, scan de fond) ne doit pas bloquer le suivant
const memoStore = new Map<string, { t: number; p: Promise<unknown> }>();
function memo<T>(key: string, ttl: number, fn: () => Promise<T | null>): Promise<T | null> {
  const hit = memoStore.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p as Promise<T | null>;
  const p = fn().then((v) => {
    if (v == null || (Array.isArray(v) && !v.length)) memoStore.delete(key);
    return v;
  });
  memoStore.set(key, { t: Date.now(), p });
  if (memoStore.size > 3000) memoStore.delete(memoStore.keys().next().value as string);
  return p;
}
const KEY = process.env.GMGN_API_KEY || "";
export const gmgnEnabled = () => !!KEY;

// Régulateur à points (on garde 1 point de marge sur les 5 du plan gratuit)
// Plan gratuit : on reste à 1 point/s (≈ 30 tokens/min en info + security), réglable si tu passes à un plan payant.
const BUDGET = Number(process.env.GMGN_POINTS_PER_2S) || 2; // 2 points par fenêtre de 2 s = 1 point/s (une bougie coûte 2 points)
const WINDOW_MS = 2000;
const MAX_WAIT_MS = 4000; // au-delà, on se passe de GMGN pour ce scan plutôt que de le ralentir
let spent: { t: number; w: number }[] = [];
let bannedUntil = 0;
async function slot(weight: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const now = Date.now();
    if (now < bannedUntil) return false; // GMGN nous a mis en pause : le scan continue sans lui
    spent = spent.filter((s) => now - s.t < WINDOW_MS);
    const used = spent.reduce((a, s) => a + s.w, 0);
    if (used + weight <= BUDGET) {
      spent.push({ t: now, w: weight });
      return true;
    }
    // Un scan de fond (flux automatique) n'attend jamais : la place est gardée pour les tokens que l'utilisateur ouvre
    if (currentPriority() === 2 || now - start > MAX_WAIT_MS) return false;
    await new Promise((r) => setTimeout(r, WINDOW_MS - (now - spent[0].t) + 20));
  }
}

async function get<T>(path: string, params: Record<string, string>, weight: number): Promise<T | null> {
  if (!KEY) return null;
  if (!(await slot(weight))) return null;
  const q = new URLSearchParams({ ...params, timestamp: String(Math.floor(Date.now() / 1000)), client_id: randomUUID() });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${HOST}${path}?${q}`, { headers: { "X-APIKEY": KEY, "Content-Type": "application/json" }, cache: "no-store", signal: ctrl.signal });
    const j = (await r.json().catch(() => null)) as { code?: number; data?: T; reset_at?: number } | null;
    if (r.status === 429 || j?.code === 429) {
      // ne plus rien envoyer avant la levée (chaque requête pendant la pause la prolonge)
      bannedUntil = Math.max(bannedUntil, (j?.reset_at ?? 0) * 1000 + 1000 || Date.now() + 10_000);
      if (process.env.VIGIL_DEBUG) console.log(`[gmgn] paused until ${new Date(bannedUntil).toISOString()}`);
      return null;
    }
    if (!r.ok || !j || j.code !== 0) return null;
    return j.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type GmgnInfo = {
  name?: string;
  symbol?: string;
  logo?: string;
  holder_count?: number;
  creation_timestamp?: number;
  launchpad_progress?: number;
  price?: { volume_24h?: string; price?: string; price_24h?: string };
  dev?: { creator_address?: string; creator_token_status?: string; creator_open_count?: number; fund_from?: string; fund_from_ts?: number };
  stat?: {
    top_bundler_trader_percentage?: string;
    top_rat_trader_percentage?: string;
    top_entrapment_trader_percentage?: string;
    fresh_wallet_rate?: string;
    top_10_holder_rate?: string;
    dev_team_hold_rate?: string;
    creator_hold_rate?: string;
    top70_sniper_hold_rate?: string;
    bot_degen_rate?: string;
  };
  wallet_tags_stat?: { sniper_wallets?: number; bundler_wallets?: number; rat_trader_wallets?: number; fresh_wallets?: number; smart_wallets?: number; renowned_wallets?: number };
  link?: { twitter_username?: string; website?: string; telegram?: string };
};
export type GmgnSecurity = {
  renounced_mint?: boolean;
  renounced_freeze_account?: boolean;
  top_10_holder_rate?: string;
  suspected_insider_hold_rate?: string;
  bundler_trader_amount_rate?: string;
  rat_trader_amount_rate?: string;
  sniper_count?: number;
  rug_ratio?: string;
  is_wash_trading?: boolean;
  creator_token_status?: string;
};

type GmgnCandle = { time: number; open: string; close: string; high: string; low: string; volume: string };
/** Bougies (time en secondes, prix en $). 2 points par appel : mises en cache 8 s, partagées entre visiteurs. */
export const gmgnKline = (mint: string, res: string) =>
  memo(`gmgn:kline:${mint}:${res}`, 8_000, async () => {
    const now = Math.floor(Date.now() / 1000);
    const span = res === "1h" ? 7 * 86400 : res === "15m" ? 2 * 86400 : res === "5m" ? 86400 : 6 * 3600;
    const d = await get<{ list?: GmgnCandle[] }>("/v1/market/token_kline", { chain: "sol", address: mint, resolution: res, from: String((now - span) * 1000), to: String(now * 1000) }, 2);
    return (d?.list ?? []).map((c) => ({ time: Math.floor(c.time / 1000), open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume }));
  });

export const gmgnInfo = (mint: string) => memo(`gmgn:info:${mint}`, 15_000, () => get<GmgnInfo>("/v1/token/info", { chain: "sol", address: mint }, 1));
export const gmgnSecurity = (mint: string) => memo(`gmgn:sec:${mint}`, 30_000, () => get<GmgnSecurity>("/v1/token/security", { chain: "sol", address: mint }, 1));

const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function gmgnSignals(mint: string): Promise<GmgnSignals | null> {
  if (!KEY) return null;
  const [info, sec] = await Promise.all([gmgnInfo(mint).catch(() => null), gmgnSecurity(mint).catch(() => null)]);
  if (!info && !sec) return null;
  const status = info?.dev?.creator_token_status ?? sec?.creator_token_status;
  const x = info?.link?.twitter_username;
  return {
    devAddress: info?.dev?.creator_address || null,
    devLaunches: num(info?.dev?.creator_open_count),
    devStatus: status === "creator_close" ? "sold" : status === "creator_hold" ? "hold" : null,
    devFunder: info?.dev?.fund_from || null,
    bundlerPct: num(sec?.bundler_trader_amount_rate) ?? num(info?.stat?.top_bundler_trader_percentage),
    insiderPct: num(sec?.suspected_insider_hold_rate),
    ratPct: num(sec?.rat_trader_amount_rate) ?? num(info?.stat?.top_rat_trader_percentage),
    sniperCount: num(sec?.sniper_count) ?? num(info?.wallet_tags_stat?.sniper_wallets),
    bundlerWallets: num(info?.wallet_tags_stat?.bundler_wallets),
    freshWalletPct: num(info?.stat?.fresh_wallet_rate),
    devTeamPct: num(info?.stat?.dev_team_hold_rate),
    rugRatio: num(sec?.rug_ratio),
    washTrading: sec?.is_wash_trading ?? null,
    socials: {
      x: x ? (x.startsWith("http") ? x : `https://x.com/${x}`) : null,
      website: info?.link?.website || null,
      telegram: info?.link?.telegram || null,
    },
  };
}
