import "server-only";
import { PublicKey } from "@solana/web3.js";
import { ticks, type Tick } from "./candles";
import { cached, rpcPriority } from "./rpc";
import { ensureLaunch, peekScan } from "./scan";

const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/**
 * Ce que chaque wallet du lancement détient ENCORE, lu directement sur la blockchain (1 requête pour 100 wallets).
 * C'est la mesure qui ne ment pas, même sur un vieux token dont les trades du début ne sont plus lus :
 * acheté au lancement − détenu maintenant = déjà revendu (ou envoyé ailleurs).
 */
async function holdingsNow(mint: string, wallets: string[], decimals: number): Promise<Map<string, number> | null> {
  return cached(`radar-hold:${mint}`, 15_000, async () => {
    const conn = rpcPriority();
    const mintPk = new PublicKey(mint);
    const prog = (await conn.getAccountInfo(mintPk).catch(() => null))?.owner;
    if (!prog) return null;
    const atas = wallets.map((w) => PublicKey.findProgramAddressSync([new PublicKey(w).toBuffer(), prog.toBuffer(), mintPk.toBuffer()], ATA_PROGRAM)[0]);
    const out = new Map<string, number>();
    for (let i = 0; i < atas.length; i += 100) {
      const infos = await conn.getMultipleAccountsInfo(atas.slice(i, i + 100)).catch(() => null);
      if (!infos) return null;
      infos.forEach((acc, j) => out.set(wallets[i + j], acc && acc.data.length >= 72 ? Number(acc.data.readBigUInt64LE(64)) / 10 ** decimals : 0));
    }
    return out;
  });
}

/**
 * Radar de sortie (F-066) : la détection de rug en direct, après le lancement.
 * Un rug, c'est le moment où ceux qui sont entrés avant tout le monde sortent. Vigil connaît ces wallets
 * (le dev, chaque acheteur des 10 premières secondes, les wallets reliés par leur financement) et lit chaque trade du token :
 * il voit qui vend, combien, et si plusieurs vendent dans la même seconde (vente coordonnée).
 */
export type RadarStatus = "dumping" | "selling" | "holding" | "unknown";
export type RadarEvent = { t: number; kind: "dev" | "coordinated" | "insider"; wallets: number; pctSupply: number; sol: number | null; text: string };
export type Radar = {
  status: RadarStatus;
  headline: string;
  insiders: number; // wallets suivis
  devSoldShare: number | null; // part de ce que le dev avait acheté au lancement qu'il a revendue
  insidersBoughtPct: number | null; // % du supply pris par les initiés au lancement
  insidersSoldPct: number; // % du supply revendu par eux depuis (trades lus)
  stillHeldShare: number | null; // part de leur achat du lancement qu'ils détiennent encore (lu sur la blockchain)
  stillHeldPct: number | null; // en % du supply
  soldLast5mPct: number;
  lastSellAgoS: number | null;
  events: RadarEvent[];
  wallets: string[]; // pour marquer leurs trades dans le flux
  coverageSince: number | null; // le plus vieux trade lu
  trades: number;
};

const fmt = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;

export async function exitRadar(mint: string): Promise<Radar> {
  const scan = peekScan(mint);
  // Traçage du lancement lancé ici si le scan ne l'a pas encore fait (3 s max, sinon il arrivera au prochain rafraîchissement)
  const launch = await Promise.race([ensureLaunch(mint).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  const now = Date.now() / 1000;
  // Supply en unités affichées (pump.fun : 1 milliard)
  const supply = scan?.market?.mcap && scan.market.priceUsd ? scan.market.mcap / scan.market.priceUsd : 1e9;
  const decimals = scan?.decimals ?? 6;

  // Qui suivre : le dev, les acheteurs des 10 premières secondes, les wallets reliés (même financeur),
  // et les plus gros détenteurs (indispensable sur un vieux token dont le lancement n'est plus traçable)
  const role = new Map<string, "dev" | "early" | "linked" | "whale">();
  const bought = new Map<string, number>();
  const dev = scan?.signals.dev.address ?? launch?.creator ?? null;
  if (launch) for (const [w, amt] of launch.early) if (amt > 0n) {
    role.set(w, "early");
    bought.set(w, Number(amt) / 10 ** decimals);
  }
  for (const h of scan?.holders ?? []) if (h.group != null && !h.pool && !role.has(h.owner)) role.set(h.owner, "linked");
  for (const h of (scan?.holders ?? []).filter((x) => !x.pool).slice(0, 10)) if (!role.has(h.owner) && h.pct >= 0.005) role.set(h.owner, "whale");
  if (dev) role.set(dev, "dev");
  const traced = !!launch && launch.early.size > 0;
  const who = traced ? "launch wallets" : "big holders";

  const empty: Radar = { status: "unknown", headline: "", insiders: role.size, devSoldShare: null, insidersBoughtPct: null, insidersSoldPct: 0, stillHeldShare: null, stillHeldPct: null, soldLast5mPct: 0, lastSellAgoS: null, events: [], wallets: [...role.keys()].slice(0, 300), coverageSince: null, trades: 0 };
  if (!role.size) return { ...empty, headline: "Vigil is still identifying the launch wallets and big holders" };

  const earlyWallets = [...bought.keys()];
  const [list0, held] = await Promise.all([
    ticks(mint).catch(() => null),
    earlyWallets.length ? holdingsNow(mint, earlyWallets.slice(0, 300), decimals).catch(() => null) : Promise.resolve(null),
  ]);
  const list: Tick[] = list0 ?? [];
  // Ce que les acheteurs du lancement détiennent encore (plafonné à ce qu'ils avaient acheté : un rachat ne "rend" pas une vente)
  let heldNow: number | null = null;
  if (held) {
    heldNow = 0;
    for (const [w, b] of bought) heldNow += Math.min(b, held.get(w) ?? 0);
  }
  const boughtAll = [...bought.values()].reduce((a, b) => a + b, 0);
  const stillHeldShare = heldNow != null && boughtAll > 0 ? heldNow / boughtAll : null;
  const stillHeldPct = heldNow != null ? heldNow / supply : null;
  if (!list.length && stillHeldShare == null) return { ...empty, headline: "Reading the trades…" };

  // Ventes et achats des initiés
  let devBuy = bought.get(dev ?? "") ?? 0;
  let devSold = 0, sold = 0, sold5m = 0;
  let lastSell: number | null = null;
  const sells: { t: number; who: string; amt: number; sol: number | null; r: "dev" | "early" | "linked" | "whale" }[] = [];
  for (const k of list) {
    if (!k.who || !k.amt) continue;
    const r = role.get(k.who);
    if (!r) continue;
    if (k.buy) {
      if (r === "dev" && !launch?.early.has(k.who)) devBuy += k.amt; // achat du dev hors des 10 premières s
      continue;
    }
    sells.push({ t: k.t, who: k.who, amt: k.amt, sol: null, r });
    sold += k.amt;
    if (r === "dev") devSold += k.amt;
    if (now - k.t <= 300) sold5m += k.amt;
    lastSell = Math.max(lastSell ?? 0, k.t);
  }

  // Ventes coordonnées : 3 initiés ou plus qui vendent dans la même fenêtre de 2 s
  const events: RadarEvent[] = [];
  sells.sort((a, b) => a.t - b.t);
  for (let i = 0; i < sells.length; ) {
    let j = i;
    while (j + 1 < sells.length && sells[j + 1].t - sells[i].t <= 2) j++;
    const group = sells.slice(i, j + 1);
    const wallets = new Set(group.map((g) => g.who));
    const amt = group.reduce((a, g) => a + g.amt, 0);
    if (wallets.size >= 3) events.push({ t: group[0].t, kind: "coordinated", wallets: wallets.size, pctSupply: amt / supply, sol: null, text: `${wallets.size} ${who} sold ${fmt(amt / supply)} of supply in the same 2 s` });
    else
      for (const g of group)
        if (g.r === "dev") events.push({ t: g.t, kind: "dev", wallets: 1, pctSupply: g.amt / supply, sol: null, text: `the dev sold ${fmt(g.amt / supply)} of supply` });
        else if (g.amt / supply >= 0.01) events.push({ t: g.t, kind: "insider", wallets: 1, pctSupply: g.amt / supply, sol: null, text: `${g.r === "whale" ? "a top holder" : "a launch wallet"} sold ${fmt(g.amt / supply)} of supply` });
    i = j + 1;
  }

  const boughtTotal = boughtAll;
  const devSoldShare = devBuy > 0 ? Math.min(1, devSold / devBuy) : devSold > 0 ? 1 : null;
  const soldPct = sold / supply;
  const sold5mPct = sold5m / supply;
  const recentCoord = events.some((e) => e.kind === "coordinated" && now - e.t <= 600);
  const recentDev = events.some((e) => e.kind === "dev" && now - e.t <= 600);

  let status: RadarStatus = "holding";
  const n = role.size, sw = n === 1 ? "wallet" : "wallets";
  let headline = traced
    ? `${n} launch ${sw} watched: none of them is selling`
    : `${n} ${sw} watched (the dev and the biggest holders): none of them is selling. This launch is too old to trace`;
  // Sorties déjà faites depuis le lancement (lues sur les soldes) : vaut aussi pour un vieux token
  const exited = stillHeldShare != null && boughtAll / supply >= 0.02 ? 1 - stillHeldShare : null;
  if ((devSoldShare ?? 0) >= 0.5 || sold5mPct >= 0.05 || recentCoord) {
    status = "dumping";
    headline =
      recentCoord ? events.filter((e) => e.kind === "coordinated").slice(-1)[0].text
      : (devSoldShare ?? 0) >= 0.5 ? `the dev sold ${Math.round((devSoldShare ?? 0) * 100)}% of what they bought`
      : `${who} sold ${fmt(sold5mPct)} of supply in the last 5 minutes`;
  } else if (soldPct >= 0.01 || recentDev) {
    status = "selling";
    headline = recentDev ? "the dev is selling" : `${who} have sold ${fmt(soldPct)} of supply so far`;
  } else if (exited != null && exited >= 0.8) {
    status = "selling";
    headline = `the launch wallets already sold ${Math.round(exited * 100)}% of what they bought: the insiders are mostly out`;
  }
  if (status === "holding" && stillHeldShare != null && boughtAll > 0) {
    const big = boughtAll / supply >= 0.02;
    if (big) headline = `launch wallets still hold ${Math.round(stillHeldShare * 100)}% of what they bought (${fmt(stillHeldPct ?? 0)} of supply): no one is selling now`;
    // Petit achat au lancement déjà revendu : pas de "personne ne vend" contradictoire, on dit ce qui s'est passé
    else if (stillHeldShare < 0.2) headline = `launch wallets only bought ${fmt(boughtAll / supply)} of supply and are already out: no insider bag left to dump`;
    else headline = `launch wallets only bought ${fmt(boughtAll / supply)} of supply and still hold ${Math.round(stillHeldShare * 100)}% of it`;
  }

  return {
    status,
    headline,
    insiders: role.size,
    devSoldShare,
    insidersBoughtPct: launch ? boughtTotal / supply : null,
    insidersSoldPct: soldPct,
    stillHeldShare,
    stillHeldPct,
    soldLast5mPct: sold5mPct,
    lastSellAgoS: lastSell == null ? null : Math.max(0, Math.round(now - lastSell)),
    events: events.slice(-8).reverse(),
    wallets: [...role.keys()].slice(0, 300),
    coverageSince: list[0]?.t ?? null,
    trades: list.length,
  };
}
