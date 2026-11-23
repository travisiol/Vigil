import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import type { ScanLite, Verdict } from "../types";
import { DATA_DIR } from "./datadir";
import { curveStats, decodeCurve } from "./pump";
import { rpcLow } from "./rpc";

/**
 * Le guetteur : suit chaque lancement pump.fun après son passage dans New pairs.
 * Toutes les 20 s, il relit d'un coup (1 requête pour 100 tokens) les bonding curves :
 *  - des lancements des 15 dernières minutes (pour noter les verdicts),
 *  - des tokens encore vivants (jusqu'à 6 h), pour les colonnes Final stretch et Migrated.
 *
 * Le bulletin de notes (F-062) : le 1er verdict affiché dans le flux est figé, puis noté 15 min après la création
 * d'après ce que la courbe est devenue. Une note n'est jamais modifiée ensuite.
 */
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const GRADE_AFTER_MS = 15 * 60_000;
const KEEP_ALIVE_MS = 6 * 3_600_000;
const SAMPLE_MS = 20_000;
const FINAL_PCT = 0.4; // Final stretch : 40 % de la courbe ou plus, pas encore migré

export type Outcome = "migrated" | "alive" | "faded" | "crashed" | "never";
export const OUTCOME_LABEL: Record<Outcome, string> = {
  migrated: "Migrated",
  alive: "Still alive",
  faded: "Faded",
  crashed: "Crashed",
  never: "Never took off",
};

type Watched = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  creator: string;
  createdAt: number;
  curve: string;
  first: { verdict: Verdict; reason: string; atS: number } | null; // 1er verdict montré dans le flux (figé)
  raisedUsd: number | null;
  peakUsd: number;
  mcapUsd: number | null;
  pct: number;
  complete: boolean;
  completedAt: number | null;
  lastSeen: number;
};

export type Graded = {
  mint: string;
  symbol: string;
  createdAt: number;
  verdict: Verdict;
  reason: string;
  verdictAtS: number;
  outcome: Outcome;
  peakUsd: number;
  endUsd: number | null;
};

const watched = new Map<string, Watched>();
// Le suivi survit aux redémarrages et aux mises à jour (F-076) : sinon Final stretch, Migrated et le bulletin repartent de zéro
const WATCH_FILE = join(DATA_DIR, "watch.json");
try {
  const cut = Date.now() - 6 * 3_600_000;
  for (const w of JSON.parse(readFileSync(WATCH_FILE, "utf8")) as Watched[]) if (w.createdAt > cut) watched.set(w.mint, w);
} catch {}
let lastWatchSave = 0;
function saveWatch() {
  if (Date.now() - lastWatchSave < 60_000) return;
  lastWatchSave = Date.now();
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(WATCH_FILE, JSON.stringify([...watched.values()]));
  } catch {}
}
let graded: Graded[] = [];
const FILE = join(DATA_DIR, "track.json");

// Le bulletin survit aux redémarrages du serveur
try {
  graded = JSON.parse(readFileSync(FILE, "utf8")) as Graded[];
} catch {
  graded = [];
}
let dirty = false;
function save() {
  if (!dirty) return;
  dirty = false;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(graded));
  } catch {}
}

/** Appelé par le flux New pairs à chaque rafraîchissement (toutes les 3 s). */
export function observe(rows: { mint: string; symbol: string; name: string; image: string | null; creator: string; createdAt: number; scan: ScanLite | null; raisedUsd: number | null; curvePct: number | null; mcap: number | null }[]) {
  const now = Date.now();
  for (const r of rows) {
    let w = watched.get(r.mint);
    if (!w) {
      w = {
        mint: r.mint,
        symbol: r.symbol,
        name: r.name,
        image: r.image,
        creator: r.creator,
        createdAt: r.createdAt,
        curve: PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(r.mint).toBuffer()], PUMP_PROGRAM)[0].toBase58(),
        first: null,
        raisedUsd: null,
        peakUsd: 0,
        mcapUsd: null,
        pct: 0,
        complete: false,
        completedAt: null,
        lastSeen: now,
      };
      watched.set(r.mint, w);
    }
    w.symbol = r.symbol || w.symbol;
    w.name = r.name || w.name;
    w.image = r.image || w.image;
    if (!w.first && r.scan) w.first = { verdict: r.scan.verdict, reason: r.scan.reason, atS: Math.round((now - r.createdAt) / 1000) };
    if (r.raisedUsd != null) absorb(w, r.raisedUsd, r.mcap, r.curvePct ?? w.pct, false, now);
  }
  startLoop();
}

function absorb(w: Watched, raisedUsd: number, mcapUsd: number | null, pct: number, complete: boolean, now: number) {
  w.raisedUsd = raisedUsd;
  w.peakUsd = Math.max(w.peakUsd, raisedUsd);
  w.mcapUsd = mcapUsd ?? w.mcapUsd;
  w.pct = pct;
  if (complete && !w.complete) {
    w.complete = true;
    w.completedAt = now;
  }
  w.lastSeen = now;
}

let onFinal: ((mint: string) => void) | null = null;
/** Le flux donne au guetteur de quoi lancer un scan complet en fond sur les tokens qui arrivent en Final stretch. */
export function setFinalStretchHandler(fn: (mint: string) => void) {
  onFinal = fn;
}

let loop: ReturnType<typeof setInterval> | null = null;
let running = false;
function startLoop() {
  if (loop) return;
  loop = setInterval(() => {
    if (running) return;
    running = true;
    // Un relevé bloqué (réseau saturé) ne doit jamais arrêter le guetteur : 60 s max, puis on repart
    void Promise.race([sample(), new Promise((r) => setTimeout(r, 60_000))])
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }, SAMPLE_MS);
}

async function sample() {
  const now = Date.now();
  // Qui suivre : les 15 dernières minutes, plus les vivants (≥ 2 k$ levés ou migrés récemment), au plus 6 h
  const list = [...watched.values()].filter((w) => {
    const age = now - w.createdAt;
    if (age <= GRADE_AFTER_MS + 60_000) return true;
    if (age > KEEP_ALIVE_MS) return false;
    return w.complete ? now - (w.completedAt ?? now) < KEEP_ALIVE_MS : (w.raisedUsd ?? 0) >= 2000;
  });
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const infos = await rpcLow()
      .getMultipleAccountsInfo(chunk.map((w) => new PublicKey(w.curve)))
      .catch(() => null);
    if (!infos) continue;
    await Promise.all(
      infos.map(async (info, j) => {
        const c = info ? decodeCurve(info.data) : null;
        if (!c) return;
        const st = await curveStats(c).catch(() => null);
        const w = chunk[j];
        const wasFinal = !w.complete && w.pct >= FINAL_PCT;
        if (st?.raisedUsd != null) absorb(w, st.raisedUsd, st.mcapUsd, st.pct, c.complete, now);
        else if (c.complete) absorb(w, w.raisedUsd ?? 0, w.mcapUsd, 1, true, now);
        if (!wasFinal && !w.complete && w.pct >= FINAL_PCT && (w.raisedUsd ?? 0) >= 1000) onFinal?.(w.mint);
      }),
    );
  }
  grade(now);
  // Oubli : ce qui n'est plus suivi
  for (const [m, w] of watched) if (now - w.createdAt > KEEP_ALIVE_MS && now - w.lastSeen > 60_000) watched.delete(m);
  if (watched.size > 20_000) for (const k of [...watched.keys()].slice(0, 5000)) watched.delete(k);
  save();
  saveWatch();
}

const gradedSet = new Set<string>();
for (const g of graded) gradedSet.add(g.mint);

function grade(now: number) {
  for (const w of watched.values()) {
    if (gradedSet.has(w.mint) || !w.first || now - w.createdAt < GRADE_AFTER_MS) continue;
    // Suivi incomplet (serveur redémarré entre-temps) : on ne note pas plutôt que noter faux
    if (now - w.createdAt > GRADE_AFTER_MS + 5 * 60_000) {
      gradedSet.add(w.mint);
      continue;
    }
    const end = w.raisedUsd;
    const peak = w.peakUsd;
    const outcome: Outcome =
      w.complete ? "migrated"
      : peak < 300 ? "never"
      : end != null && end <= 0.2 * peak ? "crashed"
      : end != null && end >= 0.5 * peak && end >= 1500 ? "alive"
      : "faded";
    graded.push({ mint: w.mint, symbol: w.symbol, createdAt: w.createdAt, verdict: w.first.verdict, reason: w.first.reason, verdictAtS: w.first.atS, outcome, peakUsd: Math.round(peak), endUsd: end == null ? null : Math.round(end) });
    gradedSet.add(w.mint);
    dirty = true;
  }
  // 7 jours d'historique au plus
  const cut = now - 7 * 86_400_000;
  if (graded.length && graded[0].createdAt < cut) graded = graded.filter((g) => g.createdAt >= cut);
}

/** Final stretch (≥ 40 % de courbe, pas migré) et Migrated (dernières 6 h), du plus avancé / récent au moins. */
export function pulse(list: "final" | "migrated") {
  const now = Date.now();
  const all = [...watched.values()].filter((w) => now - w.createdAt <= KEEP_ALIVE_MS);
  const picked =
    list === "final"
      ? // au moins 1 k$ réellement levés : écarte les courbes cotées dans une monnaie sans valeur (mcap à 0,02 $)
        all.filter((w) => !w.complete && w.pct >= FINAL_PCT && (w.raisedUsd ?? 0) >= 1000).sort((a, b) => b.pct - a.pct)
      : all.filter((w) => w.complete).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return picked.slice(0, 40);
}

/** Le bulletin : stats par verdict sur une fenêtre, et les dernières notes. */
export function trackRecord(hours = 24) {
  const since = Date.now() - hours * 3_600_000;
  const rows = graded.filter((g) => g.createdAt >= since);
  const outcomes: Outcome[] = ["migrated", "alive", "faded", "crashed", "never"];
  const byVerdict = (["clean", "watch", "bundled"] as Verdict[]).map((v) => {
    const mine = rows.filter((g) => g.verdict === v);
    const counts = Object.fromEntries(outcomes.map((o) => [o, mine.filter((g) => g.outcome === o).length])) as Record<Outcome, number>;
    // Parmi les tokens où de l'argent est vraiment entré (le reste meurt seul, quel que soit le verdict)
    const real = mine.filter((g) => g.outcome !== "never");
    return { verdict: v, n: mine.length, counts, realN: real.length, crashedOfReal: real.filter((g) => g.outcome === "crashed").length, survivedOfReal: real.filter((g) => g.outcome === "alive" || g.outcome === "migrated").length };
  });
  return {
    hours,
    total: rows.length,
    since: rows[0]?.createdAt ?? null,
    byVerdict,
    recent: rows.slice(-60).reverse(),
    tracking: [...watched.values()].filter((w) => w.first && !gradedSet.has(w.mint)).length,
  };
}

/** Toutes les notes brutes (téléchargeables) : n'importe qui peut refaire nos statistiques. */
export function trackRaw(hours = 168) {
  const since = Date.now() - hours * 3_600_000;
  return graded.filter((g) => g.createdAt >= since);
}
