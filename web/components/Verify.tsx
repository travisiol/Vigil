"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { short } from "@/lib/format";

type Proof = {
  addresses: { cashback: string | null; buyback: string | null; token: string | null };
  memos: { cashback: string; buyback: string; burn: string };
  fees: { bps: number; split: { label: string; pct: number }[]; since: number | null; trades: number; traders: number; sol: number; recent: { time: number | null; sol: number }[] };
  cashback: { dueSol: number; paidSol: number };
  buyback: { dueSol: number; spentSol: number; bought: number; burned: number; held: number; count: number; recent: { signature: string; time: number | null; kind: "buyback" | "burn"; sol: number; tokens: number }[] };
  rules: { early10sBundled: number; topWalletBundled: number; top10Watch: number; liquidityWatch: number };
  syncedAt: number;
};

const sol = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: x < 1 ? 6 : 3 })} SOL`;
const num = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pc = (x: number) => `${Math.round(x * 100)}%`;
const when = (t: number | null) => (t ? new Date(t * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");

function Addr({ a, label }: { a: string | null; label: string }) {
  return a ? (
    <a className="mono vf-addr" href={`https://solscan.io/account/${a}`} target="_blank" rel="noreferrer" title={a}>{label}: {short(a)} ↗</a>
  ) : (
    <span className="mono vf-addr pending">{label}: published at launch</span>
  );
}

function Claim({ n, title, claim, children, check }: { n: number; title: string; claim: string; children: React.ReactNode; check: React.ReactNode }) {
  return (
    <section className="card vf-claim">
      <div className="vf-h">
        <span className="vf-n mono">{String(n).padStart(2, "0")}</span>
        <div>
          <h2>{title}</h2>
          <p className="mut">{claim}</p>
        </div>
      </div>
      <div className="vf-body">{children}</div>
      <div className="vf-check"><b>Check it yourself</b>{check}</div>
    </section>
  );
}

/** Vérifier Vigil de A à Z : chaque promesse, sa preuve lue sur la blockchain, et comment la refaire soi-même. */
export default function Verify() {
  const [p, setP] = useState<Proof | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/proof")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => alive && (setP(j as Proof), setErr(false)))
        .catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const fee = (p?.fees.bps ?? 50) / 100;
  const split = p?.fees.split ?? [];
  const back = split.find((s) => /back/i.test(s.label))?.pct ?? 25;
  const buy = split.find((s) => /buyback/i.test(s.label))?.pct ?? 50;

  return (
    <>
      <div className="hero-s">
        <h1>Don&apos;t trust us. <span className="grad-text">Verify.</span></h1>
        <p className="mut">
          Every promise Vigil makes, with its proof read from the Solana chain, and how to check it yourself in a block explorer. Nothing on this page is typed by hand: it is recomputed from public transactions every minute.
        </p>
        {err && <p className="msg err" style={{ marginTop: 12 }}>Couldn&apos;t load the proofs right now. Retrying…</p>}
      </div>

      <div className="vf-list">
        <Claim
          n={1}
          title={`${fee}% per trade, nothing hidden`}
          claim="The fee is a separate transfer inside the transaction you sign, shown before you sign. Every Vigil fee is read back from the chain and counted here."
          check={<p>Open your own Vigil trade on Solscan: next to the Jupiter swap you will see one SOL transfer of exactly {fee}% for the fee. Nothing else leaves your wallet.</p>}
        >
          <div className="vf-stats">
            <div><span>Vigil trades</span><b className="mono">{p ? num(p.fees.trades) : "…"}</b></div>
            <div><span>Traders</span><b className="mono">{p ? num(p.fees.traders) : "…"}</b></div>
            <div><span>Fees received</span><b className="mono">{p ? sol(p.fees.sol) : "…"}</b></div>
          </div>
          {p && p.fees.recent.length > 0 && (
            <ul className="vf-tx">
              {p.fees.recent.map((r, i) => (
                <li key={`${r.time}-${i}`}><span className="mono mut">{when(r.time)}</span><span className="mono">{sol(r.sol)}</span><span className="mut">trade fee</span></li>
              ))}
            </ul>
          )}
          {p && !p.fees.trades && <p className="mut vf-empty">No Vigil trade yet. The first one will appear here, with its transaction.</p>}
        </Claim>

        <Claim
          n={2}
          title={`${back}% back to you, in SOL, every day`}
          claim="A quarter of every fee goes back to the wallet that paid it. No claim, no points: SOL sent to your wallet once a day."
          check={<p>Every payout comes from the cashback wallet with the memo <code>{p?.memos.cashback ?? "vigil-cashback"}</code>. On Solscan, open the cashback wallet: each payout lists the traders paid and the amounts. The Rewards page shows what you earned, read from the same transactions.</p>}
        >
          <div className="vf-stats">
            <div><span>Owed to traders ({back}% of fees)</span><b className="mono">{p ? sol(p.cashback.dueSol) : "…"}</b></div>
            <div><span>Paid so far</span><b className="mono">{p ? sol(p.cashback.paidSol) : "…"}</b></div>
            <div><span>Paid / owed</span><b className="mono">{p && p.cashback.dueSol > 0 ? pc(Math.min(1, p.cashback.paidSol / p.cashback.dueSol)) : "–"}</b></div>
          </div>
          <div className="vf-addrs"><Addr a={p?.addresses.cashback ?? null} label="Cashback wallet" /></div>
        </Claim>

        <Claim
          n={3}
          title={`${buy}% buys $VIGIL, half of it burned`}
          claim="Half of every fee buys $VIGIL on the open market. Half of what is bought is burned for good; the other half stays in the buyback wallet, in plain sight."
          check={<p>Every buyback is a transaction from the buyback wallet with the memo <code>{p?.memos.buyback ?? "vigil-buyback"}</code>; every burn carries <code>{p?.memos.burn ?? "vigil-burn"}</code>. The burns also lower the token supply shown on the token&apos;s page in any explorer.</p>}
        >
          <div className="vf-stats">
            <div><span>Owed to buybacks ({buy}% of fees)</span><b className="mono">{p ? sol(p.buyback.dueSol) : "…"}</b></div>
            <div><span>Spent on buybacks</span><b className="mono">{p ? sol(p.buyback.spentSol) : "…"}</b></div>
            <div><span>$VIGIL bought</span><b className="mono">{p ? num(p.buyback.bought) : "…"}</b></div>
            <div><span>$VIGIL burned</span><b className="mono">{p ? num(p.buyback.burned) : "…"}</b></div>
          </div>
          <div className="vf-addrs">
            <Addr a={p?.addresses.token ?? null} label="$VIGIL" />
            <Addr a={p?.addresses.buyback ?? null} label="Buyback wallet" />
          </div>
          {p && p.buyback.recent.length > 0 && (
            <ul className="vf-tx">
              {p.buyback.recent.slice(0, 10).map((r) => (
                <li key={r.signature}><span className="mono mut">{when(r.time)}</span><span className="mono">{r.kind === "burn" ? `🔥 ${num(r.tokens)} burned` : `${sol(r.sol)} → ${num(r.tokens)} $VIGIL`}</span><a href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer">transaction ↗</a></li>
              ))}
            </ul>
          )}
          {p && !p.addresses.token && <p className="mut vf-empty">$VIGIL is not launched yet. Until then, the buyback share is set aside; the first buyback will spend all of it, and it will show up here.</p>}
        </Claim>

        <Claim
          n={4}
          title="The same rules for every token"
          claim="No paid placement, no manual override. Every token gets the same checks with the same thresholds, published here and in the Docs."
          check={<p>Open any token and read its verdict reason. The wallets behind it are shown in the scan panel and the bubble map, and every trade in the live feed links to its transaction on Solscan.</p>}
        >
          {p && (
            <ul className="vf-rules">
              <li><b>Bundled</b> when {pc(p.rules.early10sBundled)}+ of supply is taken in the first 10 s, or one wallet holds {pc(p.rules.topWalletBundled)}+, or linked wallets / serial devs are found.</li>
              <li><b>Watch</b> when the top 10 hold {pc(p.rules.top10Watch)}+, liquidity is under {pc(p.rules.liquidityWatch)} of market cap, or an authority is still active.</li>
            </ul>
          )}
          <p className="vf-more"><Link href="/docs">Every rule in the Docs →</Link></p>
        </Claim>

        <Claim
          n={5}
          title="Your keys never leave your wallet"
          claim="Vigil never holds your funds. Every trade is a transaction your own wallet shows you and asks you to sign."
          check={<p>Before you sign, your wallet lists every account the transaction touches: the Jupiter swap, the {fee}% fee transfer, and nothing else. Vigil&apos;s server only relays transactions that you already signed.</p>}
        >
          <div className="vf-stats">
            <div><span>Custody</span><b>None</b></div>
            <div><span>Routing</span><b>Jupiter</b></div>
            <div><span>Simulated before you sign</span><b>Yes</b></div>
          </div>
        </Claim>
      </div>
      {p && <p className="mut" style={{ fontSize: 12, marginTop: 14 }}>Recomputed from the chain at {new Date(p.syncedAt).toLocaleTimeString()}.</p>}
    </>
  );
}
