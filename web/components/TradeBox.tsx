"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { brand } from "@/brand.config";
import { quote, signAndSend } from "@/lib/client/trade";
import { fromRaw, toRaw } from "@/lib/format";
import type { SwapQuote } from "@/lib/types";

type Props = { mint: string; symbol: string; decimals: number | null };

export default function TradeBox({ mint, symbol, decimals }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  // Barre d'achat mobile (en bas de la page token) : choisit le côté et amène ici
  useEffect(() => {
    const on = (e: Event) => {
      const want = (e as CustomEvent<"buy" | "sell">).detail;
      setSide(want);
      setAmount(want === "buy" ? String(brand.trade.buyPresetsSol[1]) : "");
    };
    window.addEventListener("vigil:trade", on);
    return () => window.removeEventListener("vigil:trade", on);
  }, []);
  const [amount, setAmount] = useState(String(brand.trade.buyPresetsSol[1]));
  const [slip, setSlip] = useState<number>(brand.trade.defaultSlippageBps);
  const [bal, setBal] = useState<{ sol: number; token: bigint } | null>(null);
  const [q, setQ] = useState<SwapQuote | null>(null);
  const [state, setState] = useState<"idle" | "quoting" | "signing" | "sending">("idle");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; sig?: string } | null>(null);
  // "Sell 25 / 50 / 100 %" depuis la carte Ta position : prépare la vente et la fait chiffrer, il ne reste qu'à confirmer
  const [autoSell, setAutoSell] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setSide("sell");
      setAutoSell((e as CustomEvent<number>).detail);
    };
    window.addEventListener("vigil:sell", on);
    return () => window.removeEventListener("vigil:sell", on);
  }, []);

  // Solde lu sur la blockchain. Juste après un trade, on garde le solde "attendu" tant que la blockchain n'a pas suivi
  // (sinon "Sell 100 %" calculait 100 % de l'ancien solde : 0).
  const expected = useRef<{ token: bigint; until: number } | null>(null);
  const loadBal = useCallback(async (): Promise<{ sol: number; token: bigint } | null> => {
    if (!publicKey) {
      setBal(null);
      return null;
    }
    const r = await fetch(`/api/portfolio?owner=${publicKey.toBase58()}`).catch(() => null);
    if (!r?.ok) return null;
    const j = (await r.json()) as { sol: number; holdings: { mint: string; amount: string }[] };
    let token = BigInt(j.holdings.find((h) => h.mint === mint)?.amount ?? "0");
    const e = expected.current;
    if (e && Date.now() < e.until && token !== e.token) token = e.token; // la blockchain n'a pas encore suivi
    else expected.current = null;
    const next = { sol: j.sol, token };
    setBal(next);
    return next;
  }, [publicKey, mint]);
  const refreshSoon = () => [500, 1500, 3000, 6000, 10000].forEach((ms) => setTimeout(() => void loadBal(), ms));

  useEffect(() => {
    loadBal();
  }, [loadBal]);

  useEffect(() => {
    setQ(null);
  }, [side, amount, slip]);

  const dec = decimals ?? 6;
  const rawAmount = side === "buy" ? toRaw(amount || "0", 9) : toRaw(amount || "0", dec);

  const setSellPct = async (p: number) => {
    // Solde relu avant de calculer le pourcentage (jamais "100 % de 0" juste après un achat)
    const b = bal && bal.token > 0n ? bal : await loadBal();
    if (!b) return;
    setAmount(fromRaw((b.token * BigInt(p)) / 100n, dec, dec).replace(/,/g, ""));
  };

  // Vente préparée depuis la carte position : montant fixé dès que le solde est connu, puis chiffrage auto
  const [reviewNext, setReviewNext] = useState(false);
  useEffect(() => {
    if (autoSell == null || side !== "sell") return;
    if (!bal) {
      void loadBal();
      return;
    }
    const pct = autoSell;
    setAutoSell(null);
    void setSellPct(pct).then(() => setReviewNext(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSell, side, bal]);

  // Un seul clic (F-074) : Vigil prépare la transaction et ouvre ton wallet dans la foulée. Le temps réel est affiché.
  const go = async () => {
    if (!publicKey) return setVisible(true);
    setMsg(null);
    setState("quoting");
    const t0 = performance.now();
    let fresh: SwapQuote;
    try {
      fresh = await quote({ side, mint, amount: rawAmount, taker: publicKey.toBase58(), slippageBps: slip });
      setQ(fresh);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : brand.copy.error });
      setState("idle");
      return;
    }
    await confirm(fresh, t0);
  };

  useEffect(() => {
    if (!reviewNext || side !== "sell" || rawAmount === "0") return;
    setReviewNext(false);
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewNext, rawAmount, side]);

  const confirm = async (q: SwapQuote, _t0: number) => {
    if (!signTransaction) return;
    setState("signing");
    let tSigned = 0;
    try {
      const res = await signAndSend(q, async (tx) => {
        const s = await signTransaction(tx);
        tSigned = performance.now();
        setState("sending");
        return s;
      });
      const land = ((performance.now() - tSigned) / 1000).toFixed(1);
      if (res.status === "failed") setMsg({ kind: "err", text: "The trade failed on-chain. Nothing was charged except the network fee.", sig: res.signature });
      else {
        setMsg({ kind: "ok", text: res.status === "confirmed" ? `Trade confirmed ${land} s after you signed.` : "Sent. Still confirming…", sig: res.signature });
        // Solde attendu tout de suite (achat : + tokens reçus ; vente : − tokens vendus), puis relectures rapprochées
        const cur = bal?.token ?? 0n;
        const moved = BigInt(side === "buy" ? q.outAmount : q.inAmount);
        const exp = side === "buy" ? cur + moved : cur > moved ? cur - moved : 0n;
        expected.current = { token: exp, until: Date.now() + 15_000 };
        setBal((b) => (b ? { ...b, token: exp } : b));
        // La carte "Ta position" se met à jour tout de suite
        window.dispatchEvent(new CustomEvent("vigil:traded", { detail: { side, tokens: side === "buy" ? Number(q.outAmount) / 10 ** dec : Number(q.inAmount) / 10 ** dec } }));
      }
      setQ(null);
      refreshSoon();
    } catch (e) {
      const text = e instanceof Error ? e.message : brand.copy.error;
      setMsg({ kind: "err", text: /reject|denied|cancel/i.test(text) ? "You cancelled in your wallet." : text });
    } finally {
      setState("idle");
    }
  };

  const outLabel = q ? (side === "buy" ? `${fromRaw(q.outAmount, dec)} ${symbol}` : `${fromRaw(q.outAmount, 9)} SOL`) : null;
  const minLabel = q ? (side === "buy" ? `${fromRaw(q.minOut, dec)} ${symbol}` : `${fromRaw(q.minOut, 9)} SOL`) : null;

  return (
    <aside className="card trade" id="trade" aria-label="Trade">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on-buy" : undefined} onClick={() => { setSide("buy"); setAmount(String(brand.trade.buyPresetsSol[1])); }}>Buy</button>
        <button role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on-sell" : undefined} onClick={() => { setSide("sell"); setAmount(""); }}>Sell</button>
      </div>
      <div className="tb">
        <div className="lbl">
          <span>{side === "buy" ? "You pay" : "You sell"}</span>
          {bal && <span className="mono">{side === "buy" ? `${bal.sol.toFixed(3)} SOL` : `${fromRaw(bal.token, dec)} ${symbol}`}</span>}
        </div>
        <div className="amt">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} aria-label="Amount" placeholder="0" />
          <span>{side === "buy" ? "SOL" : symbol}</span>
        </div>
        {side === "buy" ? (
          <div className="presets">
            {brand.trade.buyPresetsSol.map((v) => (
              <button key={v} aria-pressed={amount === String(v)} onClick={() => setAmount(String(v))}>{v}</button>
            ))}
          </div>
        ) : (
          <div className="presets three">
            {brand.trade.sellPresetsPct.map((p) => (
              <button key={p} onClick={() => void setSellPct(p)} disabled={!publicKey}>{p}%</button>
            ))}
          </div>
        )}
        <div className="lbl"><span>Max slippage</span></div>
        <div className="presets three">
          {brand.trade.slippagePresetsBps.map((b) => (
            <button key={b} aria-pressed={slip === b} onClick={() => setSlip(b)}>{b / 100}%</button>
          ))}
        </div>

        <div className="sum">
          <div><span>Vigil fee · {brand.fees.cashbackPct}% back</span><b>{brand.fees.tradeFeeBps / 100}%{q ? ` · ${fromRaw(q.feeLamports, 9, 6)} SOL` : ""}</b></div>
          {q && <div><span>Cashback, paid daily</span><b style={{ color: "var(--ok)" }}>{fromRaw(((BigInt(q.feeLamports) * BigInt(brand.fees.cashbackPct)) / 100n).toString(), 9, 6)} SOL</b></div>}
          {q && <div><span>You get about</span><b>{outLabel}</b></div>}
          {q && <div><span>At least</span><b>{minLabel}</b></div>}
          {q?.networkFeeLamports && <div><span>Network fee (fast)</span><b>{fromRaw(q.networkFeeLamports, 9, 6)} SOL</b></div>}
          {q && <div><span>Price impact</span><b>{q.priceImpactPct == null ? "–" : `${(q.priceImpactPct * 100).toFixed(2)}%`}</b></div>}
        </div>

        {!publicKey ? (
          <button className="btn btn-main" onClick={() => setVisible(true)}>Connect wallet</button>
        ) : (
          <button className={`btn ${side === "buy" ? "btn-main" : "btn-sell"}`} onClick={go} disabled={state !== "idle" || rawAmount === "0"}>
            {state === "quoting" ? "Preparing…" : state === "signing" ? "Approve in your wallet…" : state === "sending" ? "Confirming on-chain…" : side === "buy" ? `Buy ${amount || 0} SOL` : `Sell ${amount ? fromRaw(rawAmount, dec, 2) : 0} ${symbol}`}
          </button>
        )}
        {msg && (
          <p className={`msg ${msg.kind}`} role="status">
            {msg.text}{" "}
            {msg.sig && <a href={`https://solscan.io/tx/${msg.sig}`} target="_blank" rel="noreferrer">View</a>}
          </p>
        )}
        <p className="mut" style={{ fontSize: 12 }}>Non-custodial: you sign every trade in your own wallet. Routed by Jupiter.</p>
      </div>
    </aside>
  );
}
