import "server-only";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { Market, Scan, ScanLite } from "../types";
import { peekScan, scan } from "./scan";
import { apiSlot, cached, getTxs, rpcPriority as rpc, RPC_URL, withPriority } from "./rpc";
import { markets } from "./dex";
import { devInfo, recordLaunch, type DevInfo } from "./devs";
import { curveStats, decodeCurve } from "./pump";
import { observe, pulse, setFinalStretchHandler } from "./watch";

/**
 * Nouveaux lancements pump.fun, lus directement sur la blockchain.
 * Chaque création pump.fun signe avec l'autorité de mint de pump.fun : ses signatures = les lancements, rien d'autre.
 */
const PUMP_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const SKIP_MINTS = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);

export type Launch = { mint: string; creator: string; createdAt: number; signature: string; name: string | null; symbol: string | null; image: string | null };

const known = new Map<string, Launch | null>(); // signature → lancement (null = pas un lancement lisible)
const tries = new Map<string, number>(); // essais de lecture des métadonnées par mint

function extract(tx: ParsedTransactionWithMeta, signature: string): Launch | null {
  if (!tx.meta || tx.meta.err || !tx.blockTime) return null;
  // Un nouveau mint signe toujours sa propre création : on ne garde qu'un mint qui est aussi signataire.
  // (Évite de prendre un vieux token touché par la même transaction, ex. un routeur qui achète autre chose.)
  const keys = tx.transaction.message.accountKeys;
  const signers = new Set(keys.slice(1).filter((k) => k.signer).map((k) => k.pubkey.toBase58()));
  let mint: string | null = null;
  for (const inner of tx.meta.innerInstructions ?? [])
    for (const ix of inner.instructions)
      if ("parsed" in ix && /^initializeMint2?$/.test(ix.parsed?.type) && signers.has(ix.parsed.info?.mint)) mint ??= ix.parsed.info.mint as string;
  if (!mint) {
    const mints = [...new Set((tx.meta.postTokenBalances ?? []).map((b) => b.mint))].filter((m) => !SKIP_MINTS.has(m) && signers.has(m));
    mint = mints[0] ?? null;
  }
  if (!mint) return null;
  return { mint, creator: tx.transaction.message.accountKeys[0].pubkey.toBase58(), createdAt: tx.blockTime * 1000, signature, name: null, symbol: null, image: null };
}

type DasAsset = { id: string; content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string }; files?: { uri?: string; cdn_uri?: string }[] } };

/** Nom, symbole, image via l'API DAS de Helius (une requête pour tout le lot). */
async function metadata(mints: string[]): Promise<Map<string, DasAsset>> {
  const out = new Map<string, DasAsset>();
  if (!mints.length || !RPC_URL.includes("helius")) return out;
  await apiSlot(true);
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "vigil", method: "getAssetBatch", params: { ids: mints } }),
    cache: "no-store",
  });
  if (!r.ok) return out;
  const j = (await r.json()) as { result?: (DasAsset | null)[] };
  for (const a of j.result ?? []) if (a?.id) out.set(a.id, a);
  return out;
}

// 80 derniers lancements (~2-3 min) : avec les filtres par défaut (devs en série, morts), il en reste assez à l'écran (F-076)
export function newLaunches(limit = 80): Promise<Launch[]> {
  return cached("launches", 2_500, async () => {
    const conn = rpc();
    const sigs = (await conn.getSignaturesForAddress(new PublicKey(PUMP_MINT_AUTHORITY), { limit: 100 })).filter((s) => !s.err);
    // Au plus 30 nouveaux lancements lus par tour (les plus récents d'abord) : au démarrage il y en a 100,
    // et tout lire d'un coup bloquait le flux 20 s et plus (F-076). Les plus anciens se complètent aux tours suivants.
    // Instance neuve : 12 d'abord pour afficher vite, puis 30 par tour
    const todo = sigs.map((s) => s.signature).filter((s) => !known.has(s)).slice(0, known.size ? 30 : 12);
    for (let i = 0; i < todo.length; i += 25) {
      const txs = await getTxs(conn, todo.slice(i, i + 25));
      txs.forEach((tx, j) => {
        const l = tx ? extract(tx, todo[i + j]) : null;
        known.set(todo[i + j], l);
        if (l) recordLaunch(l.creator, l.mint, l.createdAt); // mémoire des devs, tracée en arrière-plan
      });
    }
    const list = sigs.map((s) => known.get(s.signature)).filter((l): l is Launch => !!l).slice(0, limit);

    // Les métadonnées (nom, image) arrivent parfois quelques secondes après la création : on redemande tant qu'il manque l'image (5 essais)
    const missing = list.filter((l) => (l.name == null || l.image == null) && (tries.get(l.mint) ?? 0) < 5).map((l) => l.mint);
    for (const m of missing) tries.set(m, (tries.get(m) ?? 0) + 1);
    const meta = await metadata(missing).catch(() => new Map<string, DasAsset>());
    for (const l of list) {
      const a = meta.get(l.mint);
      if (!a) continue;
      l.name = a.content?.metadata?.name?.trim() || l.name;
      l.symbol = a.content?.metadata?.symbol?.trim() || l.symbol;
      l.image = a.content?.files?.[0]?.cdn_uri || a.content?.links?.image || a.content?.files?.[0]?.uri || l.image;
    }
    // Garder la mémoire petite
    if (known.size > 2000) for (const k of [...known.keys()].slice(0, known.size - 1000)) known.delete(k);
    if (tries.size > 3000) for (const k of [...tries.keys()].slice(0, 1500)) tries.delete(k);
    return list;
  });
}

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

type Curve = { mcapUsd: number | null; pct: number; raisedUsd: number | null; quoteMint: string; soldShare: number };

/**
 * Premier regard (F-056) : la courbe lue par le flux donne, sans requête de plus, la part du supply achetée
 * dans les ~10 premières secondes. On garde la lecture la plus proche de 10 s (jusqu'à 14 s).
 */
const firstLook = new Map<string, { share: number; ageS: number }>();
const FIRST_LOOK_MAX_MS = 14_000;

/**
 * Lit les bonding curves pump.fun : market cap, progression vers la migration, argent réellement entré.
 * Tout est converti en $ avec la vraie monnaie de cotation (SOL, ou une autre comme NVDAx).
 */
async function curves(mints: string[]): Promise<Map<string, Curve>> {
  const out = new Map<string, Curve>();
  if (!mints.length) return out;
  const pdas = mints.map((m) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(m).toBuffer()], PUMP_PROGRAM)[0]);
  const infos = await rpc().getMultipleAccountsInfo(pdas);
  await Promise.all(
    infos.map(async (info, i) => {
      const c = info ? decodeCurve(info.data) : null;
      const st = c ? await curveStats(c).catch(() => null) : null;
      if (st) out.set(mints[i], { mcapUsd: st.mcapUsd, pct: st.pct, raisedUsd: st.raisedUsd, quoteMint: st.quoteMint, soldShare: st.soldShare });
    }),
  );
  return out;
}

/**
 * Auto-scan côté serveur (F-050) : chaque lancement vivant est scanné dès ses 10 premières secondes,
 * que quelqu'un regarde ou non. Le verdict part ensuite avec la ligne du flux : plus d'attente côté écran.
 * - spam (dev en série / ferme à devs) : jugé sur la mémoire du dev, sans dépenser de scan
 * - mort (moins de 1 k$ levés après 90 s) : rien
 * - vivant : scan rapide ; s'il attire de l'argent réel (≥ 1 k$ levés ou ≥ 3 % de courbe) : scan complet
 */
const SCAN_AFTER_MS = 12_000;
const ALIVE_USD = 1000;
const ACTIVE_USD = 300; // en dessous, personne n'achète vraiment : pas de scan
const scheduled = new Set<string>();
const pending: { mint: string; depth: "quick" | "full" }[] = [];
let inflight = 0;
let fullInflight = 0;
const deferred: { mint: string; depth: "quick" | "full" }[] = []; // scans complets en attente de leur voie
const MAX_AUTO = 3;

function runAuto() {
  while (inflight < MAX_AUTO && pending.length) {
    const job = pending.pop()!; // le plus récent d'abord
    // 2 voies : les scans complets (lourds) ne doivent jamais bloquer les rapides
    if (job.depth === "full" && fullInflight >= 1) {
      deferred.push(job);
      if (deferred.length > 10) deferred.shift();
      continue;
    }
    inflight++;
    if (job.depth === "full") fullInflight++;
    const t0 = Date.now();
    withPriority(2, () => scan(job.mint, job.depth)) // passe après les tokens ouverts par un utilisateur
      .then((s) => process.env.VIGIL_DEBUG && console.log(`[auto] ${job.depth} ${job.mint.slice(0, 6)} ${s.verdict} ${Date.now() - t0}ms (queue ${pending.length})`))
      .catch((e) => process.env.VIGIL_DEBUG && console.log(`[auto] ${job.depth} ${job.mint.slice(0, 6)} ERROR ${String(e?.message).slice(0, 80)} ${Date.now() - t0}ms`))
      .finally(() => {
        inflight--;
        if (job.depth === "full") {
          fullInflight--;
          const next = deferred.pop();
          if (next) pending.push(next);
        }
        runAuto();
      });
  }
}
function schedule(mint: string, depth: "quick" | "full") {
  const key = `${depth}:${mint}`;
  if (scheduled.has(key)) return;
  scheduled.add(key);
  pending.push({ mint, depth });
  if (pending.length > 30) pending.splice(0, pending.length - 30); // en rafale, on laisse tomber les plus vieux
  if (scheduled.size > 5000) for (const k of [...scheduled].slice(0, 2500)) scheduled.delete(k);
  runAuto();
}

const isSpam = (d: DevInfo | null) => !!d && (d.launches24h >= 3 || d.farm >= 2 || d.launches7d >= 10);
const lite = (s: Scan): ScanLite => ({
  mint: s.mint,
  verdict: s.verdict,
  reason: s.reason,
  depth: s.depth,
  checkedAt: s.checkedAt,
  signals: { top10Pct: s.signals.top10Pct, early10s: { pct: s.signals.early10s.pct }, dev: { holdsPct: s.signals.dev.holdsPct } },
});
function memoryVerdict(mint: string, d: DevInfo): ScanLite {
  const reason =
    d.launches24h >= 3 ? `serial dev: this wallet launched ${d.launches24h} tokens in 24 h`
    : d.farm >= 2 ? `dev farm: the wallet that funded this dev also funded ${d.farm} other dev wallets`
    : `serial dev: this wallet launched ${d.launches7d} tokens this week`;
  return { mint, verdict: "bundled", reason, depth: "memory", checkedAt: Date.now(), signals: { top10Pct: null, early10s: { pct: null }, dev: { holdsPct: null } } };
}

/**
 * Verdict immédiat (vers 8–14 s) tiré du premier regard sur la courbe. Le scan rapide puis complet le remplacent ensuite.
 * ≥ 30 % du supply acheté dans les premières secondes = Bundled ; ≥ 15 % = Watch.
 */
function firstLookVerdict(mint: string, look: { share: number; ageS: number }, d: DevInfo | null): ScanLite {
  const pct = `${(look.share * 100).toFixed(look.share < 0.1 ? 1 : 0)}%`;
  const fresh = d?.fresh ? ", dev wallet made just before launch" : "";
  const verdict = look.share >= 0.3 ? "bundled" : look.share >= 0.15 || d?.fresh ? "watch" : "clean";
  const reason = verdict === "bundled" ? `${pct} of supply bought in the first ${look.ageS} s` : `${pct} of supply bought in the first ${look.ageS} s${fresh}`;
  return { mint, verdict, reason: `${reason} · first look`, depth: "memory", checkedAt: Date.now(), signals: { top10Pct: null, early10s: { pct: look.share }, dev: { holdsPct: null } } };
}

/** Lancements + marché : DexScreener quand il connaît déjà le token, sinon la bonding curve lue sur la blockchain. */
// Une fois démarré, le flux tourne en continu côté serveur (le scan avance même si personne ne regarde)
let loop: ReturnType<typeof setInterval> | null = null;
let loopBusy = false;
function startLoop() {
  if (loop) return;
  // toutes les 3 s, mais jamais deux tours en même temps : un tour lent ne doit pas s'empiler (F-076)
  loop = setInterval(() => {
    if (loopBusy) return;
    loopBusy = true;
    void newPairs()
      .catch(() => {})
      .finally(() => {
        loopBusy = false;
      });
  }, 3_000);
}

export async function newPairs(): Promise<(Market & { creator: string; dev: DevInfo | null; early: { share: number; ageS: number } | null })[]> {
  startLoop();
  const list = await newLaunches();
  const [m, c] = await Promise.all([
    markets(list.map((l) => l.mint)).catch(() => new Map<string, Market>()),
    curves(list.map((l) => l.mint)).catch(() => new Map<string, Curve>()),
  ]);
  const now = Date.now();
  if (firstLook.size > 5000) for (const k of [...firstLook.keys()].slice(0, 2500)) firstLook.delete(k);
  const rows = list.map((l) => {
    const mk = m.get(l.mint);
    const cv = c.get(l.mint);
    const curveMcap = cv?.mcapUsd ?? null;
    const raisedUsd = cv?.raisedUsd ?? null;
    const dev = devInfo(l.creator, l.createdAt);
    const age = now - l.createdAt;
    const dead = raisedUsd != null && age > 90_000 && raisedUsd < ALIVE_USD;
    const spam = isSpam(dev);
    // Entonnoir : on ne scanne que les tokens où de l'argent réel entre (le reste meurt presque toujours seul)
    const active = (raisedUsd ?? 0) >= ACTIVE_USD || (cv?.pct ?? 0) >= 0.01;
    if (!spam && !dead && active && age >= SCAN_AFTER_MS) {
      schedule(l.mint, "quick");
      if ((raisedUsd ?? 0) >= ALIVE_USD || (cv?.pct ?? 0) >= 0.03) schedule(l.mint, "full");
    }
    // Premier regard : part du supply achetée dans les ~10 premières secondes, lue sur la courbe (aucune requête de plus)
    if (cv && age <= FIRST_LOOK_MAX_MS) firstLook.set(l.mint, { share: cv.soldShare, ageS: Math.max(1, Math.round(age / 1000)) });
    const look = firstLook.get(l.mint);
    const done = peekScan(l.mint);
    return {
      // Un dev repéré comme spammeur après le scan : la mémoire l'emporte sur un "Clean" devenu périmé
      scan:
        spam && dev && (!done || done.verdict !== "bundled") ? memoryVerdict(l.mint, dev)
        : done ? lite(done)
        // Un bundle se fait dans le bloc de création : si 30 % ou plus sont déjà partis, inutile d'attendre 10 s
        : look && (age >= 8_000 || look.share >= 0.3) ? firstLookVerdict(l.mint, look, dev)
        : null,
      early: look ?? null,
      curvePct: cv?.pct ?? null,
      raisedUsd,
      dev,
      mint: l.mint,
      symbol: l.symbol || mk?.symbol || l.mint.slice(0, 4),
      name: l.name || mk?.name || "New token",
      image: l.image || mk?.image || null,
      priceUsd: mk?.priceUsd ?? null,
      mcap: mk?.mcap ?? curveMcap,
      liquidity: mk?.liquidity ?? null,
      change1h: mk?.change1h ?? null,
      change24h: mk?.change24h ?? null,
      volume24h: mk?.volume24h ?? null,
      pairAddress: mk?.pairAddress ?? null,
      dexId: mk?.dexId ?? "pumpfun",
      createdAt: l.createdAt,
      creator: l.creator,
    };
  });
  // Le guetteur suit chaque lancement après son passage ici (Final stretch, Migrated, bulletin des verdicts)
  observe(rows);
  last = { rows, at: Date.now() };
  return rows;
}

/**
 * Réponse instantanée pour l'écran (F-075) : la boucle du serveur recalcule le flux toutes les 3 s ;
 * l'écran reçoit le dernier résultat tout de suite au lieu d'attendre un nouveau calcul (0,5 à 2,4 s avant).
 */
let last: { rows: Awaited<ReturnType<typeof newPairs>>; at: number } | null = null;

/** La ligne du flux pour un token récent (déjà calculée) : sert de réponse immédiate à l'en-tête de la page token. */
export function feedRow(mint: string) {
  return last?.rows.find((r) => r.mint === mint) ?? null;
}
type Rows = Awaited<ReturnType<typeof newPairs>>;
let refreshing: Promise<Rows> | null = null;
/**
 * Liste pour l'écran. Sur Vercel, la boucle de fond s'arrête dès que la réponse part : c'est donc chaque visite
 * qui relance le calcul (F-078). La liste repart tout de suite (le calcul attend au plus 1,5 s, 8 s sur une instance neuve) ;
 * s'il n'a pas fini, `pending` permet à la route de le terminer juste après la réponse (after()).
 */
export async function newPairsFast(): Promise<{ rows: Rows; pending: Promise<Rows> | null }> {
  startLoop();
  if (last && Date.now() - last.at < 3_000) return { rows: last.rows, pending: null };
  const p = (refreshing ??= newPairs().finally(() => {
    refreshing = null;
  }));
  const r = await Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), last ? 1_500 : 8_000))]);
  return { rows: r ?? last?.rows ?? [], pending: r ? null : p };
}

// Un token qui arrive en Final stretch mérite le scan complet (financements, clusters), même si personne ne l'a ouvert
setFinalStretchHandler((mint) => schedule(mint, "full"));

/** Lignes des colonnes Final stretch et Migrated, au même format que New pairs. */
export async function pulseRows(list: "final" | "migrated") {
  startLoop();
  const picked = pulse(list);
  const m = list === "migrated" ? await markets(picked.map((w) => w.mint)).catch(() => new Map<string, Market>()) : new Map<string, Market>();
  return picked.map((w) => {
    const mk = m.get(w.mint);
    const dev = devInfo(w.creator, w.createdAt);
    return {
      scan: feedVerdict(w.mint),
      early: firstLook.get(w.mint) ?? null,
      curvePct: w.complete ? 1 : w.pct,
      raisedUsd: w.raisedUsd,
      dev,
      mint: w.mint,
      symbol: w.symbol || mk?.symbol || w.mint.slice(0, 4),
      name: w.name || mk?.name || "New token",
      image: w.image || mk?.image || null,
      priceUsd: mk?.priceUsd ?? null,
      mcap: mk?.mcap ?? w.mcapUsd,
      liquidity: mk?.liquidity ?? null,
      change1h: mk?.change1h ?? null,
      change24h: mk?.change24h ?? null,
      volume24h: mk?.volume24h ?? null,
      pairAddress: mk?.pairAddress ?? null,
      dexId: mk?.dexId ?? (w.complete ? "pumpswap" : "pumpfun"),
      createdAt: w.createdAt,
      creator: w.creator,
      migratedAt: w.completedAt,
    };
  });
}

/** Verdict déjà connu du flux pour un token (scan terminé, mémoire du dev ou premier regard), sans rien recalculer. */
export function feedVerdict(mint: string): ScanLite | null {
  const done = peekScan(mint);
  if (done) return lite(done);
  let launch: Launch | null = null;
  for (const l of known.values()) if (l?.mint === mint) { launch = l; break; }
  const dev = launch ? devInfo(launch.creator, launch.createdAt) : null;
  if (dev && isSpam(dev)) return memoryVerdict(mint, dev);
  const look = firstLook.get(mint);
  return look ? firstLookVerdict(mint, look, dev) : null;
}
