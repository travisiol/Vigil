import "server-only";
import { PublicKey, SystemProgram, type ParsedAccountData, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { brand } from "@/brand.config";
import type { Reason, Scan, Verdict } from "../types";
import { apiSlot, cached, currentPriority, getTxs, rpc, RPC_URL, UserError } from "./rpc";

const PUBLIC_RPC = RPC_URL.includes("api.mainnet-beta.solana.com");
import { markets } from "./dex";
import { clusters, fundingOf, type Funding } from "./funding";
import { devInfo, ensureDev } from "./devs";
import { curvePda, isPumpToken, pumpMarket } from "./pump";
import { gmgnEnabled, gmgnSignals } from "./gmgn";

const SYSTEM = SystemProgram.programId.toBase58();

/**
 * Wallets de protocole qui détiennent du supply sans être des "personnes" (ENGINE.md §2.5, registre à enrichir).
 * - Agent "Mayhem" de pump.fun : reçoit 1 milliard de tokens (sur 2) des lancements en mode Mayhem, trade 24 h puis brûle le reste.
 */
const PROTOCOL_WALLETS = new Set(["BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"]);
const MAX_SIG_PAGES = 8; // 8 000 transactions max pour remonter au lancement
const MAX_EARLY_TX = 60;

const pctOf = (part: bigint, total: bigint) => (total > 0n ? Number((part * 1_000_000n) / total) / 1_000_000 : 0);
const fmtPct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

/** Comptes gérés par un programme (pool, bonding curve, vault) plutôt que par une personne. */
async function programOwned(owners: string[]): Promise<Set<string>> {
  const conn = rpc();
  const out = new Set<string>();
  const uniq = [...new Set(owners)];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk.map((o) => new PublicKey(o)));
    infos.forEach((info, j) => {
      if (info && info.owner.toBase58() !== SYSTEM) out.add(chunk[j]);
    });
  }
  return out;
}

type Launch = {
  traced: boolean;
  creator: string | null;
  early: Map<string, bigint>; // achats nets des 10 premières secondes, par wallet
  t0?: number; // heure du lancement (s)
  slots?: Map<string, number>; // bloc du premier achat, par wallet
};

// Le lancement ne change plus une fois passé : gardé en mémoire (économise ~60 appels RPC par token)
const traceCache = new Map<string, Launch>();
const lastTrace = new Map<string, Launch>(); // dernier traçage, même pour un token de moins d'1 min (radar de sortie)
const programAccounts = new Map<string, Set<string>>(); // courbe, pools, wallets de protocole repérés par le scan

/** Les achats des 10 premières secondes déjà tracés pour ce token (pour le radar de sortie), sans rien relancer. */
export function launchOf(mint: string): { creator: string | null; early: Map<string, bigint> } | null {
  const l = traceCache.get(`${mint}:${MAX_EARLY_TX}`) ?? traceCache.get(`${mint}:30`) ?? lastTrace.get(mint);
  if (!l?.traced) return null;
  const skip = programAccounts.get(mint);
  const early = new Map([...l.early].filter(([w]) => !skip?.has(w) && !PROTOCOL_WALLETS.has(w)));
  return { creator: l.creator, early };
}
/** Le radar n'attend plus le scan complet : il lance lui-même le traçage du lancement (pump.fun, via la courbe). */
export async function ensureLaunch(mint: string): Promise<{ creator: string | null; early: Map<string, bigint> } | null> {
  const have = launchOf(mint);
  if (have) return have;
  if (!(await isPumpToken(mint).catch(() => false))) return null;
  await traceLaunchCached(new PublicKey(mint), 30, 6).catch(() => null);
  return launchOf(mint);
}

async function traceLaunchCached(mint: PublicKey, maxTx = MAX_EARLY_TX, decimals = 6): Promise<Launch> {
  const base = mint.toBase58();
  const full = traceCache.get(`${base}:${MAX_EARLY_TX}`);
  if (full) return full; // un traçage complet sert aussi au rapide
  const k = `${base}:${maxTx}`;
  const hit = traceCache.get(k);
  if (hit) return hit;
  // Helius "transactions enrichies" : 100 transactions décodées par requête (au lieu d'une requête par transaction)
  const r = (HELIUS_KEY && (await traceLaunchEnhanced(base, decimals, maxTx === MAX_EARLY_TX ? 8 : 4).catch(() => null))) || (await traceLaunch(mint, maxTx));
  if (r.traced) {
    lastTrace.set(base, r);
    if (lastTrace.size > 2000) lastTrace.delete(lastTrace.keys().next().value as string);
  }
  if (r.traced && r.t0 && Date.now() / 1000 - r.t0 > 60) {
    traceCache.set(k, r);
    if (traceCache.size > 5000) traceCache.delete(traceCache.keys().next().value as string);
  }
  return r;
}

// Pas plus de 3 scans en même temps (protège le quota RPC)
// Deux réserves de places : les scans de fond (flux automatique) ne peuvent jamais bloquer un token qu'un utilisateur ouvre
const pools = { user: { max: 4, active: 0, waiting: [] as (() => void)[] }, bg: { max: 3, active: 0, waiting: [] as (() => void)[] } };
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const pool = currentPriority() === 2 ? pools.bg : pools.user;
  while (pool.active >= pool.max) await new Promise<void>((r) => pool.waiting.push(r));
  pool.active++;
  try {
    return await fn();
  } finally {
    pool.active--;
    pool.waiting.shift()?.();
  }
}

const HELIUS_KEY = RPC_URL.match(/api-key=([^&]+)/)?.[1] ?? null;
type EnhancedTx = {
  signature: string;
  timestamp: number;
  slot: number;
  feePayer: string;
  transactionError?: unknown;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; tokenAmount: number; mint: string }[];
};

/** Même mesure que traceLaunch, via l'API enrichie de Helius : 1 requête pour 100 transactions. */
async function traceLaunchEnhanced(m: string, decimals: number, maxPages: number): Promise<Launch | null> {
  // 1) Les signatures (1 000 par requête RPC) pour retrouver le tout début
  const conn = rpc();
  const sigs: { signature: string; blockTime?: number | null; err: unknown }[] = [];
  let before: string | undefined;
  let reached = false;
  // pump.fun : on remonte l'historique de la bonding curve, que seuls la création et les vrais trades touchent
  // (l'adresse du token est noyée sous des transactions de bots : mesuré 85 sur 100 sans échange)
  const addr = (await isPumpToken(m).catch(() => false)) ? curvePda(m) : new PublicKey(m);
  for (let p = 0; p < maxPages; p++) {
    const batch = await conn.getSignaturesForAddress(addr, { before, limit: 1000 });
    sigs.push(...batch);
    if (batch.length < 1000) {
      reached = true;
      break;
    }
    before = batch[batch.length - 1].signature;
  }
  if (!reached || !sigs.length) return { traced: false, creator: null, early: new Map() };
  const okSigs = sigs.filter((s) => !s.err && s.blockTime != null).reverse();
  if (!okSigs.length) return { traced: false, creator: null, early: new Map() };
  const start = okSigs[0].blockTime as number;
  const earlySigs = okSigs.filter((s) => (s.blockTime as number) <= start + 10).slice(0, 100).map((s) => s.signature);
  // 2) Seulement les transactions des 10 premières secondes, décodées par Helius en 1 requête
  await apiSlot();
  const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transactions: earlySigs }),
    cache: "no-store",
  });
  if (!r.ok) return null; // on retombe sur la méthode classique
  const parsed = (await r.json()) as EnhancedTx[];
  if (!Array.isArray(parsed)) return null;
  const ordered = parsed.filter((t) => t && !t.transactionError).sort((a, b) => a.slot - b.slot || a.timestamp - b.timestamp);
  if (!ordered.length) return { traced: false, creator: null, early: new Map() };
  const t0 = ordered[0].timestamp;
  const scale = 10 ** decimals;
  const early = new Map<string, bigint>();
  const slots = new Map<string, number>();
  for (const tx of ordered) {
    if (tx.timestamp > t0 + 10) break;
    for (const tt of tx.tokenTransfers ?? []) {
      if (tt.mint !== m) continue;
      const raw = BigInt(Math.round(tt.tokenAmount * scale));
      if (tt.toUserAccount) {
        early.set(tt.toUserAccount, (early.get(tt.toUserAccount) ?? 0n) + raw);
        if (!slots.has(tt.toUserAccount)) slots.set(tt.toUserAccount, tx.slot);
      }
      if (tt.fromUserAccount) early.set(tt.fromUserAccount, (early.get(tt.fromUserAccount) ?? 0n) - raw);
    }
  }
  for (const [o, d] of early) if (d <= 0n) early.delete(o);
  return { traced: true, creator: ordered[0].feePayer, early, t0, slots };
}

/** Remonte jusqu'au lancement du token et mesure qui a acheté dans les 10 premières secondes. */
async function traceLaunch(mint: PublicKey, maxTx = MAX_EARLY_TX): Promise<Launch> {
  const conn = rpc();
  const sigs: { signature: string; blockTime?: number | null; err: unknown }[] = [];
  let before: string | undefined;
  let reachedStart = false;
  for (let page = 0; page < MAX_SIG_PAGES; page++) {
    const batch = await conn.getSignaturesForAddress(mint, { before, limit: 1000 });
    sigs.push(...batch);
    if (batch.length < 1000) {
      reachedStart = true;
      break;
    }
    before = batch[batch.length - 1].signature;
  }
  if (!reachedStart || !sigs.length) return { traced: false, creator: null, early: new Map() };

  const ordered = sigs.filter((s) => !s.err && s.blockTime != null).reverse(); // du plus ancien au plus récent
  if (!ordered.length) return { traced: false, creator: null, early: new Map() };
  const t0 = ordered[0].blockTime as number;
  const earlySigs = ordered.filter((s) => (s.blockTime as number) <= t0 + 10).slice(0, maxTx).map((s) => s.signature);

  const txs: (ParsedTransactionWithMeta | null)[] = [];
  const opts = { maxSupportedTransactionVersion: 1 as 0 };
  if (PUBLIC_RPC) {
    // RPC public : une transaction à la fois, sinon il refuse (429). Lent mais exact.
    for (const sig of earlySigs.slice(0, 25)) {
      txs.push(await conn.getParsedTransaction(sig, opts));
      await new Promise((r) => setTimeout(r, 350));
    }
  } else {
    const chunks: string[][] = [];
    for (let i = 0; i < earlySigs.length; i += 20) chunks.push(earlySigs.slice(i, i + 20));
    // Lots en parallèle, l'ordre est gardé (le premier = la création)
    for (const part of await Promise.all(chunks.map((c) => getTxs(conn, c)))) txs.push(...part);
  }

  const m = mint.toBase58();
  const creator = txs[0]?.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? null;
  const early = new Map<string, bigint>();
  const slots = new Map<string, number>(); // bloc du premier achat de chaque wallet
  for (const tx of txs) {
    if (!tx?.meta) continue;
    const pre = new Map<number, { owner: string; amt: bigint }>();
    for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === m && b.owner) pre.set(b.accountIndex, { owner: b.owner, amt: BigInt(b.uiTokenAmount.amount) });
    for (const b of tx.meta.postTokenBalances ?? []) {
      if (b.mint !== m || !b.owner) continue;
      const delta = BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex)?.amt ?? 0n);
      early.set(b.owner, (early.get(b.owner) ?? 0n) + delta);
      if (delta > 0n && !slots.has(b.owner)) slots.set(b.owner, tx.slot);
    }
  }
  for (const [o, d] of early) if (d <= 0n) early.delete(o);
  return { traced: true, creator, early, t0, slots };
}

/**
 * full = false : scan rapide (lancement, holders, autorités, dev) en quelques secondes.
 * full = true : + traçage des financements sur 2 niveaux (clusters). Plus lent : réservé aux tokens qui passent l'entonnoir.
 */
async function runScan(mintStr: string, full: boolean): Promise<Scan> {
  const conn = rpc();
  const mint = new PublicKey(mintStr);

  // Avec GMGN, le scan rapide saute le traçage du lancement (le plus lent) : GMGN donne déjà dev, bundlers, insiders,
  // et le scan complet refait le traçage avec notre moteur (10 premières secondes, financements).
  const skipTrace = !full && gmgnEnabled();
  const noTrace = { traced: false, creator: null, early: new Map<string, bigint>() } as Launch;
  // pump.fun reconnu par sa bonding curve (1 lancement sur 5 n'a pas le suffixe "pump")
  const pumpP = skipTrace ? Promise.resolve(false) : isPumpToken(mintStr).catch(() => false);
  // Tout part en même temps (avant : la lecture du token bloquait le reste)
  const [acc, largest, launchRaw, g, market] = await Promise.all([
    conn.getParsedAccountInfo(mint),
    conn.getTokenLargestAccounts(mint).catch((e) => {
      // Le RPC public refuse cet appel : il faut une clé (Helius gratuit suffit)
      console.warn("largest accounts unavailable", e?.message?.slice(0, 80));
      return null;
    }),
    // Les tokens pump.fun ont toujours 6 décimales : leur traçage part tout de suite ; les autres attendent la lecture du token
    pumpP.then((isPump) =>
      !isPump
        ? noTrace
        : traceLaunchCached(mint, full ? MAX_EARLY_TX : 30, 6).catch((e) => {
            console.warn("traceLaunch", mintStr, e?.message);
            return noTrace;
          }),
    ),
    gmgnSignals(mintStr).catch(() => null),
    // DexScreener d'abord ; s'il ne connaît pas encore le token (premières minutes), la bonding curve pump.fun
    markets([mintStr])
      .then((m) => m.get(mintStr) ?? null)
      .catch(() => null)
      .then((m) => m ?? pumpMarket(mintStr).catch(() => null)),
  ]);
  const data = acc.value?.data as ParsedAccountData | undefined;
  if (!data || !("parsed" in data) || data.parsed?.type !== "mint") throw new UserError("This address is not a token.", 404);
  const info = data.parsed.info as { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null };
  const supply = BigInt(info.supply);
  const launchBase =
    !skipTrace && !(await pumpP)
      ? await traceLaunchCached(mint, full ? MAX_EARLY_TX : 30, info.decimals).catch(() => noTrace)
      : launchRaw;
  // Le dev : celui de notre traçage, sinon celui que donne GMGN
  const launch: Launch = launchBase.creator || !g?.devAddress ? launchBase : { ...launchBase, creator: g.devAddress };

  // Qui possède les plus gros comptes ?
  const holdings = new Map<string, bigint>();
  if (largest) {
    const tokenAccs = await conn.getMultipleParsedAccounts(largest.value.map((a) => a.address));
    tokenAccs.value.forEach((a, i) => {
      const owner = (a?.data as ParsedAccountData | undefined)?.parsed?.info?.owner as string | undefined;
      if (!owner) return;
      holdings.set(owner, (holdings.get(owner) ?? 0n) + BigInt(largest.value[i].amount));
    });
  }
  const pools = await programOwned([...holdings.keys(), ...launch.early.keys()]);
  for (const w of PROTOCOL_WALLETS) pools.add(w); // comptés comme protocole, pas comme détenteurs
  programAccounts.set(mintStr, pools);
  if (programAccounts.size > 3000) programAccounts.delete(programAccounts.keys().next().value as string);

  const people = [...holdings.entries()].filter(([o]) => !pools.has(o)).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const topWallet = people[0] ? { owner: people[0][0], pct: pctOf(people[0][1], supply) } : null;

  // Pour la bubble map : les 20 plus gros détenteurs (le groupe = leur financeur commun, ajouté plus bas)
  const holderRows = [...holdings.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, 20)
    .map(([owner, amt]) => ({ owner, pct: pctOf(amt, supply), pool: pools.has(owner), dev: owner === launch.creator, early: launch.early.has(owner) }));
  const top10Pct = people.length ? pctOf(people.slice(0, 10).reduce((s, [, v]) => s + v, 0n), supply) : null;

  // Les 10 premières secondes (hors pools)
  let earlySum = 0n;
  let earlyWallets = 0;
  for (const [o, v] of launch.early) {
    if (pools.has(o)) continue;
    earlySum += v;
    earlyWallets++;
  }
  const early10s: Scan["signals"]["early10s"] = { traced: launch.traced, pct: launch.traced ? pctOf(earlySum, supply) : null, wallets: launch.traced ? earlyWallets : null, snipers: null };

  // Le dev
  let dev: Scan["signals"]["dev"] = { address: launch.creator, boughtPct: null, holdsPct: null, sold: null };
  if (launch.creator) {
    const devAccs = await conn.getParsedTokenAccountsByOwner(new PublicKey(launch.creator), { mint });
    const holds = devAccs.value.reduce((s, a) => s + BigInt((a.account.data as ParsedAccountData).parsed.info.tokenAmount.amount), 0n);
    const bought = launch.early.get(launch.creator) ?? 0n;
    dev = { address: launch.creator, boughtPct: pctOf(bought, supply), holdsPct: pctOf(holds, supply), sold: pctOf(bought, supply) >= 0.005 ? holds * 2n < bought : null };
  }

  // Qui a financé qui (ENGINE.md §2.1) : premiers acheteurs + plus gros détenteurs + dev
  const earlyBuyers = [...launch.early.entries()].filter(([o]) => !pools.has(o)).sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 20).map(([o]) => o); // les 20 plus gros : ce sont eux qui pèsent dans le verdict
  const traced = [...new Set([...earlyBuyers, ...holderRows.filter((h) => !h.pool).map((h) => h.owner), ...(launch.creator ? [launch.creator] : [])])].slice(0, 32);
  const [fund] = await Promise.all([
    full ? fundingOf(traced).catch(() => new Map<string, Funding>()) : Promise.resolve(new Map<string, Funding>()),
    full && launch.creator ? ensureDev(launch.creator) : Promise.resolve(), // en rapide : la mémoire du dev se remplit en arrière-plan
  ]);
  const devMem = devInfo(launch.creator, launch.t0 ? launch.t0 * 1000 : null);
  const cls = clusters(fund, launch.creator, launch.t0 ?? null);
  const weight = (w: string) => {
    const a = launch.early.get(w) ?? 0n, b = holdings.get(w) ?? 0n;
    return a > b ? a : b;
  };
  const clusterSignals = cls.map((c) => ({
    funder: c.funder,
    wallets: c.wallets.length,
    pct: pctOf(c.wallets.reduce((s, w) => s + weight(w), 0n), supply),
    devLinked: c.devLinked,
    fresh: c.freshShare,
  }));
  const clusterOf = new Map<string, string>();
  for (const c of cls) for (const w of c.wallets) clusterOf.set(w, c.funder);
  const holders = holderRows.map((h) => ({ ...h, group: clusterOf.get(h.owner) ?? null }));
  const fundedWallets = [...fund.values()].filter((f) => f.funder || f.aged).length;
  // Bots snipers : vieux wallets très actifs qui achètent au bloc 0 sur des centaines de tokens (ils revendent vite)
  const earlySnipers = earlyBuyers.filter((w) => fund.get(w)?.aged).length;
  early10s.snipers = earlyBuyers.length ? earlySnipers : null;

  const onCurve = market?.dexId === "pumpfun";
  const liquidityToMcap = !onCurve && market?.liquidity != null && market.mcap ? market.liquidity / market.mcap : null;

  // Verdict : des faits, avec la raison en une phrase
  const t = brand.scan;
  const reasons: Reason[] = [];
  if (early10s.pct != null && early10s.pct >= t.early10sBundled)
    reasons.push({
      level: "bundled",
      text: `${early10s.wallets} wallets took ${fmtPct(early10s.pct)} of supply in the first 10 s${earlySnipers ? ` (${earlySnipers} of them sniper bots)` : ""}`,
    });
  if (topWallet && topWallet.pct >= t.topWalletBundled) reasons.push({ level: "bundled", text: `one wallet holds ${fmtPct(topWallet.pct)} of supply` });
  for (const c of clusterSignals) {
    if (c.devLinked && c.pct >= 0.03) reasons.push({ level: "bundled", text: `the dev's funding wallet also funded ${c.wallets} buyers holding ${fmtPct(c.pct)}` });
    else if (c.wallets >= 3 && c.pct >= 0.1) reasons.push({ level: "bundled", text: `${c.wallets} wallets funded by the same wallet took ${fmtPct(c.pct)} of supply` });
    else if (c.pct >= 0.05) reasons.push({ level: "watch", text: `${c.wallets} wallets funded by the same wallet hold ${fmtPct(c.pct)}` });
  }
  if (info.mintAuthority) reasons.push({ level: "watch", text: "mint authority is still active: more tokens can be created" });
  if (info.freezeAuthority) reasons.push({ level: "watch", text: "freeze authority is active: your tokens can be frozen" });
  if (top10Pct != null && top10Pct >= t.top10Watch) reasons.push({ level: "watch", text: `top 10 wallets hold ${fmtPct(top10Pct)} of supply` });
  if (liquidityToMcap != null && liquidityToMcap < t.liquidityWatch) reasons.push({ level: "watch", text: `liquidity is only ${fmtPct(liquidityToMcap)} of market cap` });
  if (dev.sold) reasons.push({ level: "watch", text: "the dev sold most of the launch buy" });
  // GMGN : historique complet du dev et étiquettes de wallets (bundlers, insiders, rat traders)
  if (g) {
    if (g.devLaunches != null && g.devLaunches >= 20) reasons.push({ level: "bundled", text: `serial dev: this wallet has launched ${g.devLaunches} tokens` });
    else if (g.devLaunches != null && g.devLaunches >= 5) reasons.push({ level: "watch", text: `the dev has launched ${g.devLaunches} tokens before` });
    if (g.bundlerPct != null && g.bundlerPct >= 0.2) reasons.push({ level: "bundled", text: `bundlers hold ${fmtPct(g.bundlerPct)} of supply` });
    else if (g.bundlerPct != null && g.bundlerPct >= 0.1) reasons.push({ level: "watch", text: `bundlers hold ${fmtPct(g.bundlerPct)} of supply` });
    if (g.insiderPct != null && g.insiderPct >= 0.2) reasons.push({ level: "bundled", text: `insiders hold ${fmtPct(g.insiderPct)} of supply` });
    else if (g.insiderPct != null && g.insiderPct >= 0.1) reasons.push({ level: "watch", text: `insiders hold ${fmtPct(g.insiderPct)} of supply` });
    if (g.ratPct != null && g.ratPct >= 0.2) reasons.push({ level: "watch", text: `rat traders hold ${fmtPct(g.ratPct)} of supply` });
    if (g.washTrading) reasons.push({ level: "watch", text: "the volume looks wash-traded" });
  }
  // Mémoire des devs : ce qu'on ne voit pas sur un explorateur, token par token
  if (devMem && devMem.launches24h >= 3) reasons.push({ level: "bundled", text: `serial dev: this wallet launched ${devMem.launches24h} tokens in 24 h` });
  else if (devMem && (devMem.launches7d ?? 0) >= 10) reasons.push({ level: "bundled", text: `serial dev: this wallet launched ${devMem.launches7d} tokens this week` });
  if (devMem && devMem.farm >= 2) reasons.push({ level: "bundled", text: `dev farm: the wallet that funded this dev also funded ${devMem.farm} other dev wallets` });
  else if (devMem && devMem.farm === 1) reasons.push({ level: "watch", text: "the wallet that funded this dev also funded another dev" });
  if (devMem?.fresh) reasons.push({ level: "watch", text: "the dev wallet was created less than 1 hour before launch" });
  // Règle forte : un groupe lié qui détient 20 % ou plus
  const linkedPct = clusterSignals.reduce((s, c) => s + c.pct, 0);
  if (clusterSignals.length && linkedPct >= 0.2 && !reasons.some((r) => r.level === "bundled" && r.text.includes("funded"))) reasons.push({ level: "bundled", text: `linked wallets hold ${fmtPct(linkedPct)} of supply` });
  if (!largest && !early10s.traced && !g) reasons.push({ level: "watch", text: "Vigil could not read the holders or the launch of this token yet" });

  const verdict: Verdict = reasons.some((r) => r.level === "bundled") ? "bundled" : reasons.length ? "watch" : "clean";
  const cleanText = [
    topWallet ? `biggest wallet ${fmtPct(topWallet.pct)}` : null,
    early10s.pct != null ? `${fmtPct(early10s.pct)} taken in the first 10 s` : null,
    skipTrace ? "dev history, bundlers and insiders look normal (launch trace next)" :
    !early10s.traced ? "no wallet holds a risky share (launch too old to trace)" : full ? `no bundle found across ${fundedWallets} wallets traced to their funding` : "no bundle in the first 10 s (funding links not traced yet)",
  ].filter(Boolean).join(", ");
  const reason = verdict === "clean" ? cleanText : reasons.find((r) => r.level === verdict)!.text;

  return {
    mint: mintStr,
    verdict,
    reason,
    reasons,
    checkedAt: Date.now(),
    decimals: info.decimals,
    signals: { holdersMeasured: !!largest, early10s, topWallet, top10Pct, dev, mintAuthority: !!info.mintAuthority, freezeAuthority: !!info.freezeAuthority, liquidityToMcap, poolsExcluded: pools.size, clusters: clusterSignals, walletsTraced: fundedWallets, devMemory: devMem, gmgn: g },
    depth: full ? "full" : "quick",
    holders,
    market: market && !market.createdAt && launch.t0 ? { ...market, createdAt: launch.t0 * 1000 } : market,
  };
}

const fullDone = new Map<string, number>(); // mint → date du dernier scan complet
const latest = new Map<string, Scan>(); // dernier scan terminé de chaque token (pour le flux)
const keep = (s: Scan) => {
  const cur = latest.get(s.mint);
  if (!cur || s.depth === "full" || cur.depth === "quick") latest.set(s.mint, s);
  if (latest.size > 3000) latest.delete(latest.keys().next().value as string);
  return s;
};

/** Dernier verdict connu, sans rien recalculer. */
export const peekScan = (mint: string) => latest.get(mint) ?? null;

export function scan(mint: string, depth: "quick" | "full" = "full"): Promise<Scan> {
  // Un scan complet récent sert aussi de scan rapide
  const f = fullDone.get(mint);
  if (depth === "quick" && f && Date.now() - f < 120_000) return cached(`scan:full:${mint}`, 120_000, () => withSlot(() => runScan(mint, true)).then(keep));
  if (depth === "quick") {
    // Un scan de fond fait sans GMGN (pour lui laisser la place) n'est pas resservi tel quel à un utilisateur
    const user = currentPriority() !== 2;
    const known = latest.get(mint);
    if (user && known && (known.signals.gmgn || !gmgnEnabled()) && Date.now() - known.checkedAt < 60_000) return Promise.resolve(known);
    return cached(`scan:quick:${mint}:${user ? "u" : "b"}`, 60_000, () => withSlot(() => runScan(mint, false)).then(keep));
  }
  return cached(`scan:full:${mint}`, 120_000, () =>
    withSlot(() => runScan(mint, true)).then((s) => {
      fullDone.set(mint, Date.now());
      if (fullDone.size > 5000) fullDone.delete(fullDone.keys().next().value as string);
      return keep(s);
    }),
  );
}
