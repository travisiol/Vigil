"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { fromRaw, short } from "@/lib/format";
import type { Scan } from "@/lib/types";

type Trade = { signature: string; time: number | null; side: "buy" | "sell"; trader: string; sol: number; tokens: string; viaVigil: boolean };

function ago(t: number | null, now: number) {
  if (!t) return "–";
  const s = Math.max(0, Math.round(now / 1000 - t));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/** Trades en direct, avec le scan dans chaque ligne : le dev et les wallets du bundle sont marqués. */
export default function TradesFeed({ mint, scan, decimals, insiders }: { mint: string; scan: Scan | null; decimals: number | null; insiders?: string[] }) {
  const { publicKey } = useWallet();
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(0);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    seen.current = new Set();
    const load = async () => {
      try {
        const r = await fetch(`/api/trades/${mint}`);
        if (!r.ok) return;
        const j = (await r.json()) as { trades: Trade[] };
        if (!alive) return;
        const first = seen.current.size === 0;
        const added = new Set(j.trades.map((t) => t.signature).filter((s) => !seen.current.has(s)));
        j.trades.forEach((t) => seen.current.add(t.signature));
        setFresh(first ? new Set() : added);
        setTrades(j.trades);
      } catch {}
    };
    load();
    const t = setInterval(load, 3500);
    const c = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, [mint]);

  const dev = scan?.signals.dev.address;
  const bundle = new Set((scan?.holders ?? []).filter((h) => h.group != null).map((h) => h.owner));
  const insider = new Set(insiders ?? []);
  const me = publicKey?.toBase58();
  const dec = decimals ?? 6;

  if (!trades) return <p className="empty">Loading live trades…</p>;
  if (!trades.length) return <p className="empty">No trades yet.</p>;
  return (
    <div className="trades">
      <table>
        <thead>
          <tr><th>Age</th><th>Type</th><th>SOL</th><th>Amount</th><th>Trader</th></tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.signature} className={fresh.has(t.signature) ? "new" : undefined}>
              <td className="mono mut">{ago(t.time, now)}</td>
              <td className={t.side === "buy" ? "b" : "s"}>{t.side === "buy" ? "Buy" : "Sell"}</td>
              <td className={`mono ${t.side === "buy" ? "b" : "s"}`}>{t.sol.toFixed(t.sol < 1 ? 3 : 2)}</td>
              <td className="mono">{fromRaw(t.tokens, dec, 0)}</td>
              <td className="mono">
                <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer">{short(t.trader)}</a>
                {t.trader === dev && <span className="tag dev">DEV</span>}
                {bundle.has(t.trader) && <span className="tag bundle">BUNDLE</span>}
                {!bundle.has(t.trader) && t.trader !== dev && insider.has(t.trader) && <span className="tag bundle" title="Bought in the first 10 seconds">INSIDER</span>}
                {t.trader === me && <span className="tag you">YOU</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
