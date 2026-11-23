import "server-only";
import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "./datadir";
import { fundingOf } from "./funding";

/**
 * Mémoire des devs (ENGINE.md §2.3, version légère en mémoire) : chaque lancement pump.fun vu par Vigil est enregistré.
 * - dev en série : le même wallet lance plusieurs tokens dans la journée
 * - ferme à devs : un même wallet finance plusieurs wallets de dev (le rugger change de wallet, pas de financeur)
 * - wallet de dev neuf : créé juste avant le lancement
 * Tout est fait en arrière-plan à l'arrivée du lancement, donc prêt avant que l'utilisateur clique.
 */

const DAY = 86_400_000;
const KEEP = 7 * DAY; // la mémoire garde 7 jours de lancements
const launchesBy = new Map<string, Map<string, number>>(); // dev → (mint → date)
const devFund = new Map<string, { funder: string | null; firstSeen: number | null; aged: boolean }>();
const devsByFunder = new Map<string, Set<string>>();
const queue: string[] = [];
let busy = false;
let startedAt = 0;

/**
 * La mémoire survit aux redémarrages (F-066) : sauvegardée sur disque toutes les 60 s, relue au démarrage.
 * C'est le signal le plus fiable de Vigil (backtest : 2 survivants sur 131 tokens de devs en série), il ne doit jamais se perdre.
 */
const DIR = DATA_DIR;
const FILE = join(DIR, "devs.json");
type Saved = { startedAt: number; launches: [string, [string, number][]][]; fund: [string, { funder: string | null; firstSeen: number | null; aged: boolean }][] };
try {
  const j = JSON.parse(readFileSync(FILE, "utf8")) as Saved;
  const cut = Date.now() - KEEP;
  startedAt = j.startedAt || 0;
  for (const [dev, list] of j.launches) {
    const m = new Map(list.filter(([, t]) => t > cut));
    if (m.size) launchesBy.set(dev, m);
  }
  for (const [dev, f] of j.fund) {
    devFund.set(dev, f);
    if (f.funder && !f.aged) devsByFunder.set(f.funder, (devsByFunder.get(f.funder) ?? new Set()).add(dev));
  }
} catch {}
let dirty = false;
let saving = false;
setInterval(() => {
  if (!dirty || saving) return;
  dirty = false;
  saving = true;
  const cut = Date.now() - KEEP;
  const launches: Saved["launches"] = [];
  for (const [dev, m] of launchesBy) {
    const list = [...m].filter(([, t]) => t > cut);
    if (list.length) launches.push([dev, list]);
    else launchesBy.delete(dev);
  }
  const keepDevs = new Set(launchesBy.keys());
  const fund: Saved["fund"] = [...devFund].filter(([dev, f]) => keepDevs.has(dev) || (f.funder && devsByFunder.get(f.funder)?.has(dev)));
  try {
    mkdirSync(DIR, { recursive: true });
  } catch {}
  void writeFile(FILE, JSON.stringify({ startedAt, launches, fund } satisfies Saved))
    .catch(() => {})
    .finally(() => {
      saving = false;
    });
}, 60_000).unref?.();

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, 4);
      const f = await fundingOf(batch, { deep: false, low: true }).catch(() => null);
      if (!f) continue;
      dirty = true;
      for (const [w, x] of f) {
        devFund.set(w, { funder: x.hubFunder ? null : x.funder, firstSeen: x.firstSeen, aged: x.aged });
        if (x.funder && !x.hubFunder && !x.aged) {
          const s = devsByFunder.get(x.funder) ?? new Set<string>();
          s.add(w);
          devsByFunder.set(x.funder, s);
        }
      }
    }
  } finally {
    busy = false;
  }
}

export function recordLaunch(dev: string, mint: string, at: number) {
  if (!startedAt) startedAt = Date.now();
  const m = launchesBy.get(dev) ?? new Map<string, number>();
  if (!m.has(mint)) dirty = true;
  m.set(mint, at);
  for (const [k, t] of m) if (Date.now() - t > KEEP) m.delete(k);
  launchesBy.set(dev, m);
  if (!devFund.has(dev) && !queue.includes(dev)) {
    queue.push(dev);
    if (queue.length > 200) queue.splice(0, queue.length - 200); // en cas de rafale, on garde les plus récents
    void pump();
  }
  if (launchesBy.size > 300_000) launchesBy.delete(launchesBy.keys().next().value as string);
}

export type DevInfo = {
  launches24h: number; // lancements de ce dev vus par Vigil sur 24 h (ce token compris)
  launches7d: number; // sur 7 jours
  farm: number; // autres wallets de dev financés par le même wallet
  funder: string | null;
  fresh: boolean | null; // wallet créé moins d'1 h avant le lancement
  traced: boolean;
  watchingSince: number; // depuis quand Vigil enregistre (la mémoire repart à zéro au redémarrage, en attendant la base de la phase 1)
};

export function devInfo(dev: string | null, launchAt: number | null): DevInfo | null {
  if (!dev) return null;
  const m = launchesBy.get(dev);
  const f = devFund.get(dev);
  const farm = f?.funder ? Math.max(0, (devsByFunder.get(f.funder)?.size ?? 1) - 1) : 0;
  return {
    launches24h: m ? [...m.values()].filter((t) => Date.now() - t < DAY).length : 0,
    launches7d: m ? m.size : 0,
    farm,
    funder: f?.funder ?? null,
    fresh: f && launchAt && f.firstSeen ? launchAt / 1000 - f.firstSeen < 3600 : f?.aged ? false : null,
    traced: !!f,
    watchingSince: startedAt,
  };
}

/** Assure qu'un dev (ouvert directement, hors flux) est tracé aussi. */
export async function ensureDev(dev: string) {
  if (devFund.has(dev)) return;
  const f = await fundingOf([dev], { deep: false }).catch(() => null);
  const x = f?.get(dev);
  if (!x) return;
  devFund.set(dev, { funder: x.hubFunder ? null : x.funder, firstSeen: x.firstSeen, aged: x.aged });
  if (x.funder && !x.hubFunder && !x.aged) devsByFunder.set(x.funder, (devsByFunder.get(x.funder) ?? new Set()).add(dev));
  dirty = true;
}
