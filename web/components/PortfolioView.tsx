"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useScans } from "@/lib/client/scans";
import { pct, price, usd } from "@/lib/format";
import type { Market } from "@/lib/types";
import { Pill, TokenIcon } from "./ui";

type Holding = { mint: string; ui: number; valueUsd: number | null; market: Market | null };

export default function PortfolioView() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [data, setData] = useState<{ sol: number; holdings: Holding[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return setData(null);
    setErr(null);
    fetch(`/api/portfolio?owner=${publicKey.toBase58()}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setData(j);
      })
      .catch((e) => setErr(e.message || "Vigil lost the signal. Retry."));
  }, [publicKey]);

  const priced = useMemo(() => (data?.holdings ?? []).filter((h) => h.market), [data]);
  const getScan = useScans(useMemo(() => priced.map((h) => h.mint), [priced]));
  const total = priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

  if (!publicKey)
    return (
      <div className="card empty">
        <p style={{ color: "var(--ink)", fontWeight: 600, marginBottom: 14 }}>Connect a wallet to see your positions and their scans.</p>
        <button className="btn btn-main" onClick={() => setVisible(true)}>Connect wallet</button>
      </div>
    );

  return (
    <>
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="card stat"><span>Tokens value</span><b className="mono">{data ? usd(total) : "…"}</b></div>
        <div className="card stat"><span>SOL balance</span><b className="mono">{data ? data.sol.toFixed(3) : "…"}</b></div>
        <div className="card stat"><span>Positions</span><b className="mono">{data ? priced.length : "…"}</b></div>
      </div>
      {err && <p className="msg err">{err}</p>}
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Token</th><th className="r">Amount</th><th className="r">Price</th><th className="r hide-m">24h</th><th className="r">Value</th><th>Scan</th></tr>
            </thead>
            <tbody>
              {priced.map((h) => {
                const s = getScan(h.mint);
                const v = !s || s === "pending" ? "scanning" : s === "error" ? "unknown" : s.verdict;
                return (
                  <tr key={h.mint}>
                    <td>
                      <Link href={`/token/${h.mint}`} className="tok">
                        <TokenIcon src={h.market?.image ?? null} alt="" symbol={h.market?.symbol} />
                        <div><b>{h.market?.symbol}</b><span>{h.market?.name}</span></div>
                      </Link>
                    </td>
                    <td className="r mono">{h.ui.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td className="r mono">{price(h.market?.priceUsd)}</td>
                    <td className={`r mono hide-m ${(h.market?.change24h ?? 0) >= 0 ? "up" : "dn"}`}>{pct(h.market?.change24h)}</td>
                    <td className="r mono">{usd(h.valueUsd)}</td>
                    <td><Pill v={v} title={typeof s === "object" ? s.reason : undefined} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && !priced.length && <p className="empty">No token positions yet. Find one on Discover.</p>}
        </div>
      </div>
    </>
  );
}
