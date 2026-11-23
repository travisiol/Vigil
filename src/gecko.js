// GeckoTerminal (bougies, liste des pools pump.fun). L'accès gratuit accepte 5 appels par minute :
// on tient un seau de 5 jetons qui se remplit d'un jeton toutes les 12,5 secondes.
const CAP = 5, REFILL_MS = 12500;
let tokens = CAP;
let last = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gecko(path) {
  for (;;) {
    const now = Date.now();
    tokens = Math.min(CAP, tokens + (now - last) / REFILL_MS);
    last = now;
    if (tokens >= 1) { tokens -= 1; break; }
    await sleep((1 - tokens) * REFILL_MS + 50);
  }
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) tokens = 0;
  if (!res.ok) throw Object.assign(new Error(`GeckoTerminal HTTP ${res.status}`), { status: res.status });
  return res.json();
}
