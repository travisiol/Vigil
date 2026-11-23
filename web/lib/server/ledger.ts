import "server-only";
import { PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from "@solana/web3.js";
import fs from "node:fs/promises";
import path from "node:path";
import { brand } from "@/brand.config";
import { getTxs, RPC_URL, rpc } from "./rpc";

/**
 * Le registre du cashback, reconstruit entièrement depuis la blockchain (FEES.md §6) :
 * - fees payées = virements trader → wallet de fees, dans une transaction qui passe par Jupiter (un trade Vigil)
 * - cashback versé = virements wallet de cashback → trader, dans une transaction avec le mémo "vigil-cashback"
 * Le fichier local n'est qu'un cache : on peut le supprimer, il se reconstruit.
 */

export const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const PAYOUT_MEMO = "vigil-cashback";
const PUBLIC_RPC = RPC_URL.includes("api.mainnet-beta.solana.com");
const MAX_PAGES = 50;

type WalletRow = { fees: string; trades: number; paid: string; lastTrade: number | null };
type Ledger = {
  v: 1;
  feeWallet: string;
  cashbackWallet: string | null;
  feeCursor: string | null; // dernière signature traitée (wallet de fees)
  payCursor: string | null; // dernière signature traitée (wallet de cashback)
  wallets: Record<string, WalletRow>;
  recent: { signature: string; from: string; lamports: string; time: number | null }[]; // 25 dernières fees Vigil
  startedAt: number; // le registre ne compte que les trades à partir de là (pas l'historique d'avant Vigil)
  syncedAt: number;
};

const FILE = process.env.LEDGER_PATH || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "ledger.json");

async function load(feeWallet: string, cashbackWallet: string | null): Promise<Ledger> {
  try {
    const l = JSON.parse(await fs.readFile(FILE, "utf8")) as Ledger;
    if (l.v === 1 && l.feeWallet === feeWallet) {
      l.recent ??= [];
      if (l.cashbackWallet !== cashbackWallet) {
        // Nouveau wallet de cashback : on garde les fees, on relit les versements depuis le nouveau wallet
        l.cashbackWallet = cashbackWallet;
        l.payCursor = null;
        for (const r of Object.values(l.wallets)) r.paid = "0";
      }
      return l;
    }
  } catch {}
  return { v: 1, feeWallet, cashbackWallet, feeCursor: null, payCursor: null, wallets: {}, recent: [], startedAt: 0, syncedAt: 0 };
}

async function save(l: Ledger) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(l));
  await fs.rename(tmp, FILE);
}

/** Nouvelles signatures depuis le curseur, de la plus ancienne à la plus récente. */
async function newSignatures(address: string, until: string | null) {
  const conn = rpc();
  const pk = new PublicKey(address);
  const out: { signature: string; blockTime: number | null }[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await conn.getSignaturesForAddress(pk, { before, until: until ?? undefined, limit: 1000 });
    for (const s of batch) if (!s.err) out.push({ signature: s.signature, blockTime: s.blockTime ?? null });
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  return out.reverse();
}

async function latestSignature(address: string) {
  const s = await rpc().getSignaturesForAddress(new PublicKey(address), { limit: 1 });
  return s[0]?.signature;
}

async function fetchTxs(sigs: string[]): Promise<(ParsedTransactionWithMeta | null)[]> {
  const conn = rpc();
  const opts = { maxSupportedTransactionVersion: 1 as 0 };
  const out: (ParsedTransactionWithMeta | null)[] = [];
  if (PUBLIC_RPC) {
    for (const s of sigs) {
      out.push(await conn.getParsedTransaction(s, opts));
      await new Promise((r) => setTimeout(r, 350));
    }
  } else {
    for (let i = 0; i < sigs.length; i += 25) out.push(...(await getTxs(conn, sigs.slice(i, i + 25))));
  }
  return out;
}

const isParsed = (ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction => "parsed" in ix;

function transfers(tx: ParsedTransactionWithMeta) {
  const out: { from: string; to: string; lamports: bigint }[] = [];
  for (const ix of tx.transaction.message.instructions) {
    if (!isParsed(ix) || ix.program !== "system" || ix.parsed?.type !== "transfer") continue;
    const i = ix.parsed.info as { source: string; destination: string; lamports: number | string };
    out.push({ from: i.source, to: i.destination, lamports: BigInt(i.lamports) });
  }
  return out;
}

const usesJupiter = (tx: ParsedTransactionWithMeta) => tx.transaction.message.accountKeys.some((k) => k.pubkey.toBase58() === JUPITER);
const hasPayoutMemo = (tx: ParsedTransactionWithMeta) =>
  tx.transaction.message.instructions.some((ix) => isParsed(ix) && ix.program === "spl-memo" && String(ix.parsed).includes(PAYOUT_MEMO));

/** Fees Vigil dans une transaction : virement du trader vers le wallet de fees, dans un trade Jupiter. */
export function feesIn(tx: ParsedTransactionWithMeta, feeWallet: string) {
  if (!tx.meta || tx.meta.err || !usesJupiter(tx)) return [];
  return transfers(tx).filter((t) => t.to === feeWallet && t.from !== feeWallet);
}

/** Cashback versé dans une transaction : virements du wallet de cashback, avec le mémo Vigil. */
export function payoutsOut(tx: ParsedTransactionWithMeta, cashbackWallet: string) {
  if (!tx.meta || tx.meta.err || !hasPayoutMemo(tx)) return [];
  return transfers(tx).filter((t) => t.from === cashbackWallet && t.to !== cashbackWallet);
}

const row = (l: Ledger, w: string) => (l.wallets[w] ??= { fees: "0", trades: 0, paid: "0", lastTrade: null });

let running: Promise<Ledger> | null = null;

/** Met le registre à jour depuis la blockchain (au plus une synchro à la fois, et pas plus d'une toutes les 20 s). */
export function syncLedger(force = false): Promise<Ledger | null> {
  const feeWallet = process.env.VIGIL_FEE_WALLET;
  if (!feeWallet) return Promise.resolve(null);
  const cashbackWallet = process.env.VIGIL_CASHBACK_WALLET || null;
  if (running) return running;
  running = (async () => {
    const l = await load(feeWallet, cashbackWallet);
    if (!force && Date.now() - l.syncedAt < 20_000) return l;

    // Premier démarrage : on part de maintenant. L'historique d'avant Vigil n'est pas relu (ni facturé en appels RPC).
    if (!l.feeCursor) {
      l.feeCursor = (await latestSignature(feeWallet)) ?? null;
      l.startedAt = Date.now();
    }
    if (cashbackWallet && !l.payCursor) l.payCursor = (await latestSignature(cashbackWallet)) ?? null;

    const fs1 = await newSignatures(feeWallet, l.feeCursor);
    const txs = await fetchTxs(fs1.map((s) => s.signature));
    txs.forEach((tx, i) => {
      if (!tx) return;
      for (const t of feesIn(tx, feeWallet)) {
        const r = row(l, t.from);
        r.fees = (BigInt(r.fees) + t.lamports).toString();
        r.trades++;
        r.lastTrade = fs1[i].blockTime;
        l.recent.unshift({ signature: fs1[i].signature, from: t.from, lamports: t.lamports.toString(), time: fs1[i].blockTime });
      }
    });
    l.recent = l.recent.slice(0, 25);
    if (fs1.length) l.feeCursor = fs1[fs1.length - 1].signature;

    if (cashbackWallet) {
      const ps = await newSignatures(cashbackWallet, l.payCursor);
      const ptxs = await fetchTxs(ps.map((s) => s.signature));
      for (const tx of ptxs) if (tx) for (const t of payoutsOut(tx, cashbackWallet)) { const r = row(l, t.to); r.paid = (BigInt(r.paid) + t.lamports).toString(); }
      if (ps.length) l.payCursor = ps[ps.length - 1].signature;
    }

    l.syncedAt = Date.now();
    await save(l);
    return l;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function cashbackOf(r: WalletRow | undefined) {
  const fees = BigInt(r?.fees ?? "0");
  const paid = BigInt(r?.paid ?? "0");
  const earned = (fees * BigInt(brand.fees.cashbackPct)) / 100n;
  const owed = earned > paid ? earned - paid : 0n;
  return { trades: r?.trades ?? 0, feesPaid: fees, earned, paid, owed, lastTrade: r?.lastTrade ?? null };
}

export function totals(l: Ledger) {
  let fees = 0n, paid = 0n, trades = 0, traders = 0;
  for (const r of Object.values(l.wallets)) {
    fees += BigInt(r.fees);
    paid += BigInt(r.paid);
    trades += r.trades;
    if (r.trades) traders++;
  }
  return { fees, paid, trades, traders };
}

export type { Ledger, WalletRow };
