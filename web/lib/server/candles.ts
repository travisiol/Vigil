import "server-only";
import { curvePda, curveStats, isPumpToken, quoteInfo, readCurve, tradeAddress } from "./pump";
import { apiSlot, cached, RPC_URL } from "./rpc";

/**
 * Bougies à la seconde construites à partir des trades lus sur la blockchain (API enrichie de Helius).
 * Prix exact de chaque trade = ce que le trader a payé (ou reçu) à la courbe / au pool, divisé par les tokens échangés
 * — sans les frais réseau, qui faussaient les petits trades.
 */
const KEY = RPC_URL.match(/api-key=([^&]+)/)?.[1] ?? null;
const SOL = "So11111111111111111111111111111111111111112";

type Ehx = {
  signature: string;
  timestamp: number;
  feePayer: string;
  transactionError?: unknown;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; tokenAmount: number; mint: string }[];
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount: number }[];
};
export type Tick = { t: number; p: number; v: number; buy: boolean; sig: string; who?: string; amt?: number }; // who = trader, amt = tokens échangés

/** Adresse de la bonding curve pump.fun du token, s'il en a une (reconnue par son compte, pas par le suffixe "pump"). */
async function curveOf(mint: string): Promise<string | null> {
  return (await isPumpToken(mint)) ? curvePda(mint).toBase58() : null;
}

/**
 * Relevé du prix sur la courbe, une fois par seconde au plus, tant qu'une page affiche le token.
 * Le prix vient directement des réserves : toujours exact et à jour, même si un trade n'a pas encore été indexé.
 */
const samples = new Map<string, { t: number; p: number; raised: number | null }[]>();
export function sampleCurve(mint: string): Promise<void> {
  return cached(`sample:${mint}`, 1000, async () => {
    if (!(await isPumpToken(mint))) return;
    const c = await readCurve(mint);
    if (!c || c.complete) return;
    const st = await curveStats(c).catch(() => null);
    if (!st?.priceUsd) return;
    const arr = samples.get(mint) ?? [];
    arr.push({ t: Math.floor(Date.now() / 1000), p: st.priceUsd, raised: st.raisedUsd });
    if (arr.length > 3600) arr.splice(0, arr.length - 3600);
    samples.set(mint, arr);
    if (samples.size > 100) samples.delete(samples.keys().next().value as string);
  });
}

/** Trades lus + relevés de la courbe, fusionnés. */
export function sampledTicks(mint: string): Tick[] {
  const arr = samples.get(mint) ?? [];
  return arr.map((s, i) => {
    const prev = arr[i - 1];
    const v = prev && s.raised != null && prev.raised != null ? Math.abs(s.raised - prev.raised) : 0;
    return { t: s.t, p: s.p, v, buy: !prev || s.p >= prev.p, sig: `curve:${s.t}` };
  });
}

const store = new Map<string, { ticks: Tick[]; seen: Set<string> }>();

async function page(mint: string, before?: string): Promise<Ehx[] | null> {
  if (!KEY) return null;
  const { address } = await tradeAddress(mint);
  // Page récente : prioritaire (quelqu'un attend le graphique). Historique plus ancien : derrière tout le reste.
  await apiSlot(!before);
  const r = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=100${before ? `&before=${before}` : ""}`, { cache: "no-store" });
  if (!r.ok) return null;
  const j = (await r.json()) as Ehx[];
  return Array.isArray(j) ? j : null;
}

async function toTick(tx: Ehx, mint: string): Promise<Tick | null> {
  if (tx.transactionError) return null;
  // Le trader n'est pas toujours celui qui paie la transaction (relais, routeurs de terminaux) :
  // on part de la bonding curve pump.fun quand le token y est encore, sinon du payeur.
  const curve = await curveOf(mint);
  let me = tx.feePayer;
  let tok = 0, counter: string | undefined;
  if (curve) {
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== mint) continue;
      if (t.fromUserAccount === curve && t.toUserAccount) { me = t.toUserAccount; tok += t.tokenAmount; counter = curve; }
      else if (t.toUserAccount === curve && t.fromUserAccount) { me = t.fromUserAccount; tok -= t.tokenAmount; counter = curve; }
    }
    if (counter) {
      // SOL (ou monnaie de cotation) entré dans / sorti de la courbe : le prix exact, quel que soit le payeur
      let lamports = 0, quoteUi = 0, quoteMint = SOL;
      for (const n of tx.nativeTransfers ?? []) if (n.toUserAccount === curve || n.fromUserAccount === curve) lamports += n.amount;
      for (const t of tx.tokenTransfers ?? []) {
        if (t.mint === mint || (t.toUserAccount !== curve && t.fromUserAccount !== curve)) continue;
        quoteUi += t.tokenAmount;
        quoteMint = t.mint;
      }
      const q = await quoteInfo(quoteMint).catch(() => null);
      const quote = quoteMint === SOL ? lamports / 1e9 + quoteUi : quoteUi;
      if (q?.usd && quote > 0 && tok) return { t: tx.timestamp, p: (quote / Math.abs(tok)) * q.usd, v: quote * q.usd, buy: tok > 0, sig: tx.signature, who: me, amt: Math.abs(tok) };
    }
    tok = 0;
    counter = undefined;
    me = tx.feePayer;
  }
  for (const t of tx.tokenTransfers ?? []) {
    if (t.mint !== mint) continue;
    if (t.toUserAccount === me) { tok += t.tokenAmount; counter ??= t.fromUserAccount; }
    else if (t.fromUserAccount === me) { tok -= t.tokenAmount; counter ??= t.toUserAccount; }
  }
  if (!tok || !counter) return null;
  // Ce qui est passé entre le trader et la courbe / le pool, dans la monnaie de cotation
  let lamports = 0, quoteUi = 0, quoteMint = SOL;
  for (const n of tx.nativeTransfers ?? []) {
    if (n.fromUserAccount === me && n.toUserAccount === counter) lamports += n.amount;
    if (n.fromUserAccount === counter && n.toUserAccount === me) lamports += n.amount;
  }
  for (const t of tx.tokenTransfers ?? []) {
    if (t.mint === mint) continue;
    const between = (t.fromUserAccount === me && t.toUserAccount === counter) || (t.fromUserAccount === counter && t.toUserAccount === me);
    if (!between) continue;
    quoteUi += t.tokenAmount;
    quoteMint = t.mint;
  }
  const q = await quoteInfo(quoteMint).catch(() => null);
  if (!q?.usd) return null;
  const quote = quoteMint === SOL ? lamports / 1e9 + quoteUi : quoteUi;
  if (quote <= 0) return null;
  const amount = Math.abs(tok);
  return { t: tx.timestamp, p: (quote / amount) * q.usd, v: quote * q.usd, buy: tok > 0, sig: tx.signature, who: me, amt: amount };
}

/** Tous les trades connus du token (premier appel : jusqu'à 1 000 trades d'historique ; ensuite : les nouveaux). */
export function ticks(mint: string): Promise<Tick[] | null> {
  return cached(`ticks:${mint}`, 1500, async () => {
    // Toujours 1 seule page (les 100 derniers trades) : la réponse part tout de suite.
    // L'historique plus ancien est complété en arrière-plan, au fil des rafraîchissements.
    const st = store.get(mint);
    const p = await page(mint);
    if (!p) return st?.ticks ?? null;
    const cur = st ?? { ticks: [], seen: new Set<string>() };
    await absorb(cur, mint, p.filter((x) => !cur.seen.has(x.signature)));
    store.set(mint, cur);
    if (store.size > 200) store.delete(store.keys().next().value as string);
    if (!st && p.length === 100) void backfill(mint, p[p.length - 1].signature);
    return cur.ticks;
  });
}

async function absorb(cur: { ticks: Tick[]; seen: Set<string> }, mint: string, txs: Ehx[]) {
  const parsed = await Promise.all(txs.map((x) => toTick(x, mint)));
  for (const tk of parsed) if (tk && !cur.seen.has(tk.sig)) { cur.ticks.push(tk); cur.seen.add(tk.sig); }
  for (const x of txs) cur.seen.add(x.signature);
  cur.ticks.sort((a, b) => a.t - b.t);
  if (cur.ticks.length > 5000) cur.ticks = cur.ticks.slice(-5000);
}

/** Remonte l'historique (jusqu'à 9 pages de plus) sans bloquer l'affichage. */
async function backfill(mint: string, before: string) {
  for (let i = 0; i < 9; i++) {
    const p = await page(mint, before).catch(() => null);
    const cur = store.get(mint);
    if (!p || !cur) return;
    await absorb(cur, mint, p.filter((x) => !cur.seen.has(x.signature)));
    if (p.length < 100) return;
    before = p[p.length - 1].signature;
  }
}

export function toCandles(list: Tick[], step: number) {
  const by = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
  for (const k of list) {
    const b = Math.floor(k.t / step) * step;
    const c = by.get(b);
    if (!c) by.set(b, { time: b, open: k.p, high: k.p, low: k.p, close: k.p, volume: k.v });
    else {
      c.high = Math.max(c.high, k.p);
      c.low = Math.min(c.low, k.p);
      c.close = k.p;
      c.volume += k.v;
    }
  }
  return [...by.values()].sort((a, b) => a.time - b.time);
}
