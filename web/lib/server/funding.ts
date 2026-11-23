import "server-only";
import { type Connection, PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from "@solana/web3.js";
import { apiSlot, getTxs, rpc, rpcLow, RPC_URL } from "./rpc";

const HELIUS_KEY = RPC_URL.match(/api-key=([^&]+)/)?.[1] ?? null;
const AGED_AT = 200; // au-delà de 200 transactions, un wallet n'est pas un wallet jetable (avant : 1 000, 30 s pour un scan complet)

/**
 * Traçage groupé (F-075) : au lieu de lire les premières transactions de chaque wallet une par une (2 requêtes par wallet,
 * ~140 requêtes pour un scan complet), on les décode toutes d'un coup avec l'API enrichie de Helius (100 par requête).
 * Scan complet : 30–37 s avant, quelques secondes maintenant.
 */
type Ehx = { signature: string; timestamp: number; transactionError?: unknown; nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount: number }[] };
async function enhanced(sigs: string[], low: boolean): Promise<Map<string, Ehx> | null> {
  if (!HELIUS_KEY || !sigs.length) return null;
  const out = new Map<string, Ehx>();
  for (let i = 0; i < sigs.length; i += 100) {
    await apiSlot(!low);
    const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactions: sigs.slice(i, i + 100) }),
      cache: "no-store",
    }).catch(() => null);
    if (!r?.ok) return null;
    const j = (await r.json().catch(() => null)) as Ehx[] | null;
    if (!Array.isArray(j)) return null;
    for (const t of j) if (t?.signature) out.set(t.signature, t);
  }
  return out;
}

/** Les premiers financeurs de plusieurs wallets en une fois (repli : traceOne, wallet par wallet). */
async function traceMany(wallets: string[], c: Connection, low: boolean): Promise<Funding[]> {
  // 200 transactions suffisent : un wallet jetable de bundle en a presque toujours moins de 50 ; au-delà, c'est un wallet actif
  const lists = await Promise.all(wallets.map((w) => c.getSignaturesForAddress(new PublicKey(w), { limit: AGED_AT }).catch(() => null)));
  const results: Funding[] = [];
  const need: { wallet: string; firstSeen: number | null; sigs: string[] }[] = [];
  wallets.forEach((w, i) => {
    const sigs = lists[i];
    if (!sigs) return;
    if (sigs.length >= AGED_AT) results.push({ wallet: w, funder: null, fundedAt: null, firstSeen: null, aged: true, hubFunder: false });
    else {
      const oldest = sigs.slice(-2).reverse();
      need.push({ wallet: w, firstSeen: oldest[0]?.blockTime ?? null, sigs: oldest.map((x) => x.signature) });
    }
  });
  const parsed = await enhanced(need.flatMap((n) => n.sigs), low);
  if (!parsed) {
    // Repli : la méthode d'origine, wallet par wallet
    const slow = await Promise.all(need.map((n) => traceOne(n.wallet, c).catch(() => null)));
    return [...results, ...slow.filter((x): x is Funding => !!x)];
  }
  for (const n of need) {
    let found: Funding | null = null;
    for (const sig of n.sigs) {
      const tx = parsed.get(sig);
      if (!tx || tx.transactionError) continue;
      const t = (tx.nativeTransfers ?? []).find((x) => x.toUserAccount === n.wallet && x.fromUserAccount && x.fromUserAccount !== n.wallet && x.amount > 0);
      if (t) {
        found = { wallet: n.wallet, funder: t.fromUserAccount as string, fundedAt: tx.timestamp ?? null, firstSeen: n.firstSeen, aged: false, hubFunder: false };
        break;
      }
    }
    results.push(found ?? { wallet: n.wallet, funder: null, fundedAt: null, firstSeen: n.firstSeen, aged: false, hubFunder: false });
  }
  return results;
}

/**
 * Traçage des financements (ENGINE.md §2.1) : pour chaque wallet, qui lui a envoyé ses premiers SOL, et quand.
 * Les bundles se cachent derrière des wallets neufs, tous alimentés par le même wallet juste avant le lancement :
 * c'est invisible sur un explorateur token par token, et c'est ce que Vigil relie.
 */

export type Funding = {
  wallet: string;
  funder: string | null; // premier wallet qui lui a envoyé des SOL
  fundedAt: number | null; // secondes
  firstSeen: number | null; // première transaction du wallet (secondes)
  aged: boolean; // plus de 1 000 transactions : vieux wallet actif (souvent un bot sniper), pas un wallet jetable
  hubFunder: boolean; // le financeur est une plateforme (exchange, gros hub) : ne prouve aucun lien
  root?: string | null; // source remontée sur 2 niveaux (financeur du financeur) quand le financeur est lui-même un wallet jetable
};

const cache = new Map<string, Funding>(); // un wallet ne change pas de premier financeur : gardé
const hubs = new Map<string, boolean>();

const isParsed = (ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction => "parsed" in ix;

function incomingSol(tx: ParsedTransactionWithMeta, wallet: string): string | null {
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)];
  for (const ix of all) {
    if (!isParsed(ix) || ix.program !== "system") continue;
    const t = ix.parsed?.type;
    const info = ix.parsed?.info ?? {};
    if ((t === "transfer" || t === "transferWithSeed") && info.destination === wallet && info.source !== wallet) return info.source;
    if (t === "createAccount" && info.newAccount === wallet && info.source !== wallet) return info.source;
  }
  return null;
}

async function traceOne(wallet: string, c: Connection = rpc()): Promise<Funding> {
  const conn = c;
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit: AGED_AT });
  if (sigs.length >= AGED_AT) return { wallet, funder: null, fundedAt: null, firstSeen: null, aged: true, hubFunder: false };
  const oldest = sigs.slice(-2).reverse(); // ses toutes premières transactions
  const firstSeen = oldest[0]?.blockTime ?? null;
  const txs = await getTxs(conn, oldest.map((s) => s.signature));
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    if (!tx || tx.meta?.err) continue;
    const funder = incomingSol(tx, wallet);
    if (funder) return { wallet, funder, fundedAt: tx.blockTime ?? null, firstSeen, aged: false, hubFunder: false };
  }
  return { wallet, funder: null, fundedAt: null, firstSeen, aged: false, hubFunder: false };
}

/** Un financeur très actif (exchange, service) relie des milliers d'inconnus : ce n'est pas un lien. */
async function isHub(addr: string, c: Connection = rpc()): Promise<boolean> {
  const hit = hubs.get(addr);
  if (hit != null) return hit;
  const s = await c.getSignaturesForAddress(new PublicKey(addr), { limit: 1000 });
  const hub = s.length >= 1000 && (s[0]?.blockTime ?? 0) - (s[s.length - 1]?.blockTime ?? 0) < 7 * 86400;
  hubs.set(addr, hub);
  if (hubs.size > 20000) hubs.delete(hubs.keys().next().value as string);
  return hub;
}

export async function fundingOf(wallets: string[], opts: { deep?: boolean; low?: boolean } = {}): Promise<Map<string, Funding>> {
  const c = opts.low ? rpcLow() : rpc();
  const deep = opts.deep ?? true;
  const out = new Map<string, Funding>();
  const todo = [...new Set(wallets)].filter((w) => {
    const hit = cache.get(w);
    if (hit) out.set(w, hit);
    return !hit;
  });
  const found = await traceMany(todo, c, !!opts.low).catch(() => [] as Funding[]);
  for (const f of found) out.set(f.wallet, f);

  // Les financeurs partagés par au moins 2 wallets : on vérifie qu'ils ne sont pas un exchange
  const count = new Map<string, number>();
  for (const f of out.values()) if (f.funder) count.set(f.funder, (count.get(f.funder) ?? 0) + 1);
  const shared = [...count.entries()].filter(([, n]) => n >= 2).map(([a]) => a);
  const hubFlags = await Promise.all(shared.map((a) => isHub(a, c).catch(() => false)));
  const hubSet = new Set(shared.filter((_, i) => hubFlags[i]));
  for (const f of out.values()) f.hubFunder = !!f.funder && hubSet.has(f.funder);

  // 2ᵉ niveau : les rugs passent souvent par des wallets intermédiaires. On remonte au financeur du financeur.
  const mids = deep ? [...new Set([...out.values()].filter((f) => f.funder && !f.hubFunder && !f.aged && f.root === undefined).map((f) => f.funder as string))].slice(0, 15) : [];
  const midInfo = new Map<string, Funding>();
  const midTodo: string[] = [];
  for (const m of mids) {
    const hit = cache.get(m);
    if (hit) midInfo.set(m, hit);
    else midTodo.push(m);
  }
  for (const f of await traceMany(midTodo, c, !!opts.low).catch(() => [] as Funding[])) midInfo.set(f.wallet, f);
  const roots = [...new Set([...midInfo.values()].map((x) => x.funder).filter((x): x is string => !!x))];
  const rootHub = new Map<string, boolean>();
  await Promise.all(roots.map(async (r) => rootHub.set(r, await isHub(r, c).catch(() => true))));
  for (const f of out.values()) {
    if (f.root === undefined) {
      const mid = f.funder ? midInfo.get(f.funder) : undefined;
      f.root = mid && !mid.aged && mid.funder && !rootHub.get(mid.funder) ? mid.funder : null;
    }
    cache.set(f.wallet, f);
  }
  for (const m of midInfo.values()) if (!cache.has(m.wallet)) cache.set(m.wallet, m);
  if (cache.size > 50000) for (const k of [...cache.keys()].slice(0, 10000)) cache.delete(k);
  return out;
}

export type Cluster = { funder: string; wallets: string[]; devLinked: boolean; freshShare: number };

/**
 * Regroupe les wallets par financeur commun (hors exchanges).
 * devLinked = le financeur est le dev, ou il a aussi financé le dev.
 */
export function clusters(fund: Map<string, Funding>, dev: string | null, launchAt: number | null): Cluster[] {
  // Union : deux wallets sont liés s'ils partagent un financeur direct OU une source à 2 niveaux
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) && parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const f of fund.values()) {
    if (!f.funder || f.hubFunder || f.aged) continue;
    union(f.funder, f.wallet);
    if (f.root) union(f.root, f.funder);
  }
  const by = new Map<string, string[]>();
  for (const f of fund.values()) {
    if (!f.funder || f.hubFunder || f.aged) continue;
    const key = find(f.wallet);
    by.set(key, [...(by.get(key) ?? []), f.wallet]);
  }
  const devFunder = dev && parent.has(dev) ? find(dev) : dev ? fund.get(dev)?.funder ?? null : null;
  const out: Cluster[] = [];
  for (const [funder, ws] of by) {
    const members = ws.filter((w) => w !== dev);
    const devLinked = funder === dev || (!!devFunder && funder === devFunder);
    if (members.length < 2 && !(devLinked && members.length >= 1)) continue;
    const fresh = members.filter((w) => {
      const f = fund.get(w);
      return launchAt != null && f?.firstSeen != null && launchAt - f.firstSeen < 3 * 3600;
    }).length;
    out.push({ funder, wallets: members, devLinked, freshShare: members.length ? fresh / members.length : 0 });
  }
  return out.sort((a, b) => b.wallets.length - a.wallets.length);
}
