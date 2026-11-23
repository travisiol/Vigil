"use client";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/brand.config";
import { markOpening } from "@/lib/client/opening";
import { setScan } from "@/lib/client/scans";
import { pct, price, short, usd, age } from "@/lib/format";
import type { Market, Scan, ScanLite } from "@/lib/types";
import BubbleMap from "./BubbleMap";
import ExitRadar, { useRadar } from "./ExitRadar";
import PriceChart from "./PriceChart";
import ScanPanel from "./ScanPanel";
import TradesFeed from "./TradesFeed";
import { TokenIcon } from "./ui";

/** Erreur "définitive" (token introuvable…) : on ne réessaie pas. Le reste (coupure, serveur occupé) est réessayé. */
class FinalError extends Error {}

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/** Appel au scan avec délai max et réessais automatiques (coupure réseau, serveur qui redémarre, quota momentané). */
async function fetchScan(mint: string, depth: "quick" | "full", signal: AbortSignal, tries = 4): Promise<Scan> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    signal.addEventListener("abort", stop);
    const timer = setTimeout(stop, depth === "quick" ? 45_000 : 120_000);
    try {
      const r = await fetch(`/api/scan/${mint}${depth === "quick" ? "?depth=quick" : ""}`, { signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 || r.status === 400) throw new FinalError(j.error || "This address is not a token.");
      if (!r.ok) throw new Error(j.error || brand.copy.error);
      return j as Scan;
    } catch (e) {
      if (e instanceof FinalError || signal.aborted) throw e;
      last = e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  }
  throw last instanceof Error ? last : new Error(brand.copy.error);
}

export default function TokenView({ mint }: { mint: string }) {
  const [scan, setS] = useState<Scan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deep, setDeep] = useState<"idle" | "running" | "failed">("idle");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"trades" | "map">("trades");
  const shown = useRef(false);

  // 1) scan rapide (quelques secondes) → la page s'affiche ; 2) scan complet en arrière-plan → la page se complète
  useEffect(() => {
    const ctrl = new AbortController();
    setErr(null);
    setDeep(shown.current ? "running" : "idle"); // en "Retry", on montre tout de suite que ça repart
    (async () => {
      try {
        const quick = await fetchScan(mint, "quick", ctrl.signal);
        if (ctrl.signal.aborted) return;
        setS((cur) => (cur?.depth === "full" ? cur : quick));
        setScan(quick);
        shown.current = true;
        if (quick.depth === "full") return;
        setDeep("running");
        const full = await fetchScan(mint, "full", ctrl.signal, 3);
        if (ctrl.signal.aborted) return;
        setS(full);
        setScan(full);
        setDeep("idle");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // si le rapide est déjà affiché, on garde la page et on signale juste que le détail n'a pas pu finir
        if (shown.current) setDeep("failed");
        else setErr(e instanceof FinalError ? e.message : "Vigil couldn't reach the chain for this token. It's usually a short hiccup.");
      }
    })();
    return () => ctrl.abort();
  }, [mint, attempt]);

  // Prix / market cap rafraîchis toutes les 8 s (le scan, lui, reste en cache 2 min)
  // Verdict déjà connu du flux : affiché tout de suite, avant même la fin du scan rapide
  const [early, setEarly] = useState<ScanLite | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/lite/${mint}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j?.verdict && setEarly(j.verdict as ScanLite))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mint]);
  const [live, setLive] = useState<Market | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/market/${mint}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j?.market && setLive(j.market as Market))
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint]);
  const m: Market | null | undefined = live ? { ...live, createdAt: live.createdAt ?? scan?.market?.createdAt ?? null } : scan?.market;

  // Graphique TradingView (DexScreener), affiché tout de suite.
  // Token pump.fun : DexScreener utilise l'adresse de la bonding curve comme adresse de paire → connue sans rien demander.
  // /api/pair (déjà chauffé au survol) dit si le token a migré vers un autre pool ; on l'attend 400 ms au plus.
  // Suffixe "pump" : courbe connue tout de suite. Sinon (1 lancement sur 5), /api/pair dit si le token a une courbe.
  const fastCurve = useMemo(() => (mint.endsWith("pump") ? PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0].toBase58() : null), [mint]);
  const [apiCurve, setApiCurve] = useState<string | null>(null);
  const curve = fastCurve ?? apiCurve;
  const [pair, setPair] = useState<string | null | undefined>(undefined);
  const [waited, setWaited] = useState(false);
  const [wasUnlisted, setWasUnlisted] = useState(false);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = setTimeout(() => alive && setWaited(true), 400);
    const ask = () =>
      fetch(`/api/pair/${mint}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive) return;
          const p = (j?.pairAddress as string | null) ?? null;
          if (j?.curve) setApiCurve(j.curve as string);
          setPair(p);
          // Pas encore listé (token de moins de ~40 s) : on redemande toutes les 5 s, puis on recharge le graphique une fois
          if (!p) {
            setWasUnlisted(true);
            if (++tries < 40) timer = setTimeout(ask, 5000);
          }
        })
        .catch(() => alive && (setPair((x) => x ?? null), ++tries < 40 && (timer = setTimeout(ask, 5000))));
    ask();
    return () => {
      alive = false;
      clearTimeout(guard);
      clearTimeout(timer);
    };
  }, [mint]);
  // Graphique (F-069) :
  // - paire déjà indexée par DexScreener → TradingView tout de suite ;
  // - token pas encore indexé (premières minutes) → graphique Vigil tout de suite (prix lu sur la courbe chaque seconde),
  //   et TradingView se charge EN CACHÉ dès que DexScreener liste la paire, puis le remplace en fondu : jamais de cadre vide.
  const [base, setBase] = useState<"tv" | "live" | null>(null);
  useEffect(() => {
    if (base) return;
    if (pair) return setBase("tv");
    if (pair === null || waited) setBase("live");
  }, [pair, waited, base]);
  const tvPair = pair || (base === "tv" ? m?.pairAddress ?? null : null);
  const [tvShown, setTvShown] = useState(false); // TradingView visible (après chargement caché)
  const [liveGone, setLiveGone] = useState(false);
  useEffect(() => {
    if (base === "tv") setTvShown(true);
  }, [base]);
  const onTvLoad = () => {
    markOpening(mint, { chart: true });
    if (tvShown) return;
    // DexScreener dessine le graphique un peu après le chargement de la page : on lui laisse 1,5 s avant le fondu
    setTimeout(() => {
      setTvShown(true);
      setTimeout(() => setLiveGone(true), 600);
    }, 1500);
  };
  const ready = base !== null;
  const tvKey = tvPair ?? "none";
  const symbol = m?.symbol ?? short(mint);

  // Radar de sortie (dev, wallets du lancement, gros détenteurs)
  const radar = useRadar(mint, true); // démarre tout de suite : il se complète au fil des scans

  // Écran de transition : on lui signale chaque étape réellement franchie
  useEffect(() => markOpening(mint, { page: true }), [mint]);
  const knownVerdict = scan?.verdict ?? early?.verdict ?? null;
  useEffect(() => {
    if (knownVerdict) markOpening(mint, { verdict: knownVerdict });
  }, [mint, knownVerdict]);
  useEffect(() => {
    if (m?.symbol) markOpening(mint, { symbol: m.symbol, image: m.image ?? null });
  }, [mint, m?.symbol, m?.image]);
  useEffect(() => {
    if (base === "live") markOpening(mint, { chart: true });
  }, [mint, base]);


  if (err)
    return (
      <div className="card empty">
        <p style={{ color: "var(--ink)", fontWeight: 600, marginBottom: 6 }}>{err}</p>
        <p className="mono" style={{ marginBottom: 16 }}>{mint}</p>
        <button className="btn btn-main" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
      </div>
    );

  return (
    <div className="tgrid">
      <div>
        <div className="thead">
          <TokenIcon src={m?.image ?? null} alt="" symbol={m?.symbol} />
          <div>
            <h1>{m ? `$${m.symbol.replace(/^\$+/, "")}` : "Scanning…"}</h1>
            <span className="copyca">
              {short(mint)}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(mint).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </span>
          </div>
          <div className="px">
            <b className="mono">{price(m?.priceUsd)}</b>
            <span className={`mono ${(m?.change24h ?? 0) >= 0 ? "up" : "dn"}`}>{pct(m?.change24h)} 24h</span>
          </div>
        </div>

        <div className="kpis">
          <div><b>{usd(m?.mcap)}</b><span>Market cap</span></div>
          {m?.dexId === "pumpfun" && m.curvePct != null ? (
            <div><b>{Math.round(m.curvePct * 100)}%</b><span>Bonding curve{m.raisedUsd != null ? ` · ${usd(m.raisedUsd)} in` : ""}</span></div>
          ) : (
            <div><b>{m?.dexId === "pumpfun" ? "curve" : usd(m?.liquidity)}</b><span>Liquidity</span></div>
          )}
          <div><b>{usd(m?.volume24h)}</b><span>Volume 24h</span></div>
          <div><b>{age(m?.createdAt)}</b><span>Age · {m?.dexId ?? "–"}</span></div>
        </div>

        <section className="card">
          {!ready ? (
            <div className="chart-skel" aria-label="Loading chart"><span className="dotlive" aria-hidden="true" /> Loading chart…</div>
          ) : (
            <div className={`chart-stack ${base === "live" && !liveGone ? "has-live" : ""}`}>
              {base === "live" && !liveGone && (
                <PriceChart key={mint} mint={mint} supply={m?.mcap && m?.priceUsd ? m.mcap / m.priceUsd : null} createdAt={m?.createdAt ?? null} />
              )}
              {tvPair && (
                // Graphique TradingView complet (outils, indicateurs) via DexScreener, en bougies d'1 seconde
                <iframe
                  key={tvKey}
                  className={`chart tv ${base === "live" ? "over" : ""} ${tvShown ? "on" : "off"}`}
                  title={`${symbol} chart`}
                  onLoad={onTvLoad}
                  src={`https://dexscreener.com/solana/${tvPair}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=1&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=1S`}
                />
              )}
            </div>
          )}
          <div className="chart-foot mut">
            {base === "live" && !tvShown ? <span><span className="dotlive" aria-hidden="true" /> Live chart from the bonding curve · TradingView takes over as soon as DexScreener indexes this token</span> : <span />}
            <span>
              <a href={`https://gmgn.ai/sol/token/${mint}`} target="_blank" rel="noreferrer">GMGN</a>
              {tvPair && <> · <a href={`https://dexscreener.com/solana/${tvPair}`} target="_blank" rel="noreferrer">DexScreener</a></>}
            </span>
          </div>
        </section>

        {deep !== "idle" && scan && (
          <p className={`msg ${deep === "failed" ? "err" : ""} deep-note`} role="status">
            {deep === "running" ? (
              <><span className="dotlive" aria-hidden="true" /> Quick verdict shown. Tracing who funded the first buyers…</>
            ) : (
              <>Funding links couldn't be traced right now. <button className="linkbtn" onClick={() => setAttempt((a) => a + 1)}>Retry</button></>
            )}
          </p>
        )}
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-h">
            <div className="tabs2" role="tablist">
              <button role="tab" aria-selected={view === "trades"} onClick={() => setView("trades")}>Live trades</button>
              <button role="tab" aria-selected={view === "map"} onClick={() => setView("map")}>Bubble map</button>
            </div>
            <span className="mut" style={{ fontSize: 12 }}>{view === "trades" ? "Dev and bundle wallets are tagged" : "Top 20 holders, linked when the same wallet funded them"}</span>
          </div>
          {view === "trades" ? <TradesFeed mint={mint} scan={scan} decimals={scan?.decimals ?? null} insiders={radar?.wallets} /> : <BubbleMap scan={scan} />}
        </section>
      </div>
      <div className="tside">
        <ScanPanel scan={scan} early={early} />
        <ExitRadar r={radar} />
      </div>
    </div>
  );
}
