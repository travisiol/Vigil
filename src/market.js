// État actuel des tokens via l'API publique DexScreener (pas de clé).
// Sert seulement à savoir si un token est mort, vivant ou migré. En cas d'échec : marché inconnu.
export async function fetchMarkets(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    let pairs;
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      pairs = await res.json();
    } catch { continue; }
    if (!Array.isArray(pairs)) continue;
    for (const p of pairs) {
      const mint = p.baseToken?.address;
      if (!mint || !chunk.includes(mint)) continue;
      const liq = p.liquidity?.usd ?? 0;
      const prev = out[mint];
      if (prev && prev.liquidityUsd >= liq) continue;
      out[mint] = {
        marketCap: p.marketCap ?? p.fdv ?? null,
        liquidityUsd: liq,
        priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
        dex: p.dexId || null,
        migrated: !!p.dexId && p.dexId !== 'pumpfun',
        url: p.url || null,
        pair: p.pairAddress || null,
        name: p.baseToken?.name || null,
        symbol: p.baseToken?.symbol || null,
      };
    }
  }
  return out;
}
