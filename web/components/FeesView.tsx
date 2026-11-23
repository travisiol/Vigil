"use client";
import { useEffect, useState } from "react";
import { brand } from "@/brand.config";
import { short } from "@/lib/format";

type Fees = {
  wallet: string | null;
  cashbackWallet: string | null;
  feeBps: number;
  split: { label: string; pct: number; note: string }[];
  since?: number | null;
  totals?: { feesSol: number; cashbackPaidSol: number; trades: number; traders: number };
  recent?: { signature: string; time: number | null; sol: number }[];
};

export default function FeesView() {
  const [f, setF] = useState<Fees | null>(null);
  useEffect(() => {
    fetch("/api/fees").then((r) => r.json()).then(setF).catch(() => {});
  }, []);
  const split = f?.split ?? brand.fees.split;
  const t = f?.totals;

  return (
    <>
      <div className="flow">
        <div><i>1</i><b>You trade</b><span>Buy or sell any token from your own wallet.</span></div>
        <div><i>2</i><b>{brand.fees.tradeFeeBps / 100}% fee in SOL</b><span>Half the usual 1%. Inside the transaction you sign, shown before you confirm.</span></div>
        <div><i>3</i><b>Counted in public</b><span>Every Vigil fee is read from the chain and counted here, trade by trade.</span></div>
        <div><i>4</i><b>Split in public</b><span>Cashback, buyback and operations, as below.</span></div>
      </div>

      {t && (
        <div className="grid3" style={{ marginBottom: 14 }}>
          <div className="card stat"><span>Fees collected</span><b className="mono">{t.feesSol.toFixed(4)} SOL</b><p>{t.trades.toLocaleString("en-US")} trades{f?.since ? ` since ${new Date(f.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</p></div>
          <div className="card stat"><span>Cashback paid to traders</span><b className="mono" style={{ color: "var(--ok)" }}>{t.cashbackPaidSol.toFixed(4)} SOL</b><p>{t.traders.toLocaleString("en-US")} traders</p></div>
          <div className="card stat"><span>Cashback wallet</span><b className="mono" style={{ fontSize: 18 }}>{f?.cashbackWallet ? short(f.cashbackWallet) : "–"}</b><p>Pays every trader once a day</p></div>
        </div>
      )}

      <div className="grid3">
        {split.map((s) => (
          <div key={s.label} className="card stat">
            <span>{s.label}</span>
            <b className="grad-text">{s.pct}%</b>
            <p>{s.note}</p>
            {t && <p className="mono" style={{ color: "var(--ink)" }}>{((t.feesSol * s.pct) / 100).toFixed(4)} SOL so far</p>}
          </div>
        ))}
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2>Latest Vigil fees</h2></div>
        {f?.recent && (
          <div className="list">
            {f.recent.length ? (
              f.recent.map((r, i) => (
                <div key={`${r.time}-${i}`} className="row">
                  <span className="mono">Trade fee</span>
                  <span className="mono">{r.sol.toFixed(6)} SOL</span>
                  <span className="mut">{r.time ? new Date(r.time * 1000).toLocaleString() : "–"}</span>
                </div>
              ))
            ) : (
              <div className="row"><span className="mut">No Vigil trades yet. The first fee will show up here.</span></div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
