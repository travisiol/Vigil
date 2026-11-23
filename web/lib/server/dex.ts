import "server-only";
import type { Market } from "../types";
import { cached } from "./rpc";

const DS = "https://api.dexscreener.com";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`dexscreener ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

type DsPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  priceChange?: { h1?: number; h24?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(+v) ? +v : null);

function toMarket(p: DsPair): Market {
  return {
    mint: p.baseToken.address,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    image: p.info?.imageUrl ?? null,
    priceUsd: num(p.priceUsd),
    mcap: num(p.marketCap) ?? num(p.fdv),
    liquidity: num(p.liquidity?.usd),
    change1h: num(p.priceChange?.h1),
    change24h: num(p.priceChange?.h24),
    volume24h: num(p.volume?.h24),
    pairAddress: p.pairAddress,
    dexId: p.dexId,
    createdAt: num(p.pairCreatedAt),
  };
}

/** Meilleure paire (plus de liquidité, puis de volume) pour chaque mint. */
export async function markets(mints: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  const uniq = [...new Set(mints)];
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    const pairs = await cached(`ds:${chunk.join(",")}`, 20_000, () => getJson<DsPair[]>(`${DS}/tokens/v1/solana/${chunk.join(",")}`));
    const best = new Map<string, DsPair>();
    for (const p of pairs ?? []) {
      if (p.chainId !== "solana") continue;
      const m = p.baseToken.address;
      if (!chunk.includes(m)) continue;
      const cur = best.get(m);
      const score = (x: DsPair) => (x.liquidity?.usd ?? 0) * 10 + (x.volume?.h24 ?? 0);
      if (!cur || score(p) > score(cur)) best.set(m, p);
    }
    for (const [m, p] of best) out.set(m, toMarket(p));
  }
  return out;
}

type DsListed = { chainId: string; tokenAddress: string; icon?: string };

/** Tokens Solana du moment : boosts + profils récents de DexScreener, enrichis et triés par volume. */
export function trending(): Promise<Market[]> {
  return cached("trending", 30_000, async () => {
    const lists = await Promise.allSettled([
      getJson<DsListed[]>(`${DS}/token-boosts/top/v1`),
      getJson<DsListed[]>(`${DS}/token-boosts/latest/v1`),
      getJson<DsListed[]>(`${DS}/token-profiles/latest/v1`),
    ]);
    const mints: string[] = [];
    const icons = new Map<string, string>();
    for (const l of lists)
      if (l.status === "fulfilled")
        for (const t of l.value ?? []) {
          if (t.chainId !== "solana") continue;
          if (!mints.includes(t.tokenAddress)) mints.push(t.tokenAddress);
          if (t.icon && !icons.has(t.tokenAddress)) icons.set(t.tokenAddress, t.icon);
        }
    if (!mints.length) throw new Error("no trending tokens");
    const m = await markets(mints.slice(0, 90));
    return [...m.values()]
      .map((x) => (x.image ? x : { ...x, image: icons.get(x.mint) ?? null }))
      .filter((x) => (x.volume24h ?? 0) > 0 && (x.mcap ?? 0) > 0)
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, 60);
  });
}
