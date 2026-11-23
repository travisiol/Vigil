"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@/brand.config";
import { fromRaw, short } from "@/lib/format";

type Cashback = {
  live: boolean;
  cashbackPct: number;
  minSol: number;
  payoutHourUtc: number;
  cashbackWallet: string | null;
  trades: number;
  feesPaid: string;
  earned: string;
  paid: string;
  owed: string;
  syncedAt: number | null;
};

function useCountdown(hourUtc: number) {
  const [now, setNow] = useState<number | null>(null); // null au rendu serveur : évite un écart d'hydratation
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return "--:--:--";
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (d.getUTCHours() >= hourUtc ? 1 : 0), hourUtc);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const sol = (raw: string, frac = 6) => `${fromRaw(raw, 9, frac)} SOL`;

export default function RewardsView() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [c, setC] = useState<Cashback | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const countdown = useCountdown(brand.fees.payoutHourUtc);

  useEffect(() => {
    if (!publicKey) return setC(null);
    let alive = true;
    const load = () =>
      fetch(`/api/cashback?wallet=${publicKey.toBase58()}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          if (alive) setC(j);
        })
        .catch((e) => alive && setErr(e.message || brand.copy.error));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [publicKey]);

  const fee = brand.fees.tradeFeeBps / 100;
  const pct = brand.fees.cashbackPct;
  const below = c ? Number(c.owed) / 1e9 < c.minSol : false;

  return (
    <>
      <div className="rw-hero card beam">
        <div>
          <span className="mut" style={{ fontSize: 13 }}>Next payout in</span>
          <b className="mono rw-clock">{countdown}</b>
          <span className="mut" style={{ fontSize: 13 }}>every day at {String(brand.fees.payoutHourUtc).padStart(2, "0")}:00 UTC, in SOL, straight to your wallet</span>
        </div>
        <div className="rw-owed">
          <span className="mut" style={{ fontSize: 13 }}>Waiting for you</span>
          {publicKey ? (
            <b className="mono grad-text">{c ? sol(c.owed) : "…"}</b>
          ) : (
            <button className="btn btn-main" onClick={() => setVisible(true)} style={{ marginTop: 10 }}>Connect wallet</button>
          )}
          {c && below && Number(c.owed) > 0 && <span className="mut" style={{ fontSize: 12 }}>Under {c.minSol} SOL it rolls into the next payout.</span>}
        </div>
      </div>

      {err && <p className="msg err" style={{ marginTop: 14 }}>{err}</p>}

      {publicKey && (
        <div className="grid3" style={{ marginTop: 14 }}>
          <div className="card stat"><span>Trades on Vigil</span><b className="mono">{c ? c.trades : "…"}</b></div>
          <div className="card stat"><span>Fees you paid</span><b className="mono">{c ? sol(c.feesPaid, 4) : "…"}</b><p>{fee}% per trade</p></div>
          <div className="card stat"><span>Cashback earned · paid</span><b className="mono" style={{ color: "var(--ok)" }}>{c ? sol(c.earned, 4) : "…"}</b><p>{c ? `${sol(c.paid, 4)} already in your wallet` : ""}</p></div>
        </div>
      )}

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h2>How it works</h2></div>
        <div className="steps3">
          <div><i>1</i><b>You trade</b><p>Every trade pays a {fee}% fee in SOL, shown before you sign.</p></div>
          <div><i>2</i><b>{pct}% is yours</b><p>A quarter of every fee you pay is set aside for you. Real cost: {(brand.fees.tradeFeeBps * (100 - pct)) / 10000}% per trade.</p></div>
          <div><i>3</i><b>Paid every day</b><p>Vigil sends it to the wallet you traded with, in SOL. No claim, no form, no points.</p></div>
        </div>
        <p className="note">
          Every number here is read from the chain: your fee transfers to the fee wallet
          , and our payouts from the cashback wallet
          {c?.cashbackWallet ? <> <a className="mono" href={`https://solscan.io/account/${c.cashbackWallet}`} target="_blank" rel="noreferrer">{short(c.cashbackWallet)}</a></> : null}
          . Anyone can check them. See <Link href="/fees" style={{ textDecoration: "underline" }}>where the rest goes</Link>.
        </p>
      </section>
    </>
  );
}
