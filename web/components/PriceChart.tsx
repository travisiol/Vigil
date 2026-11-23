"use client";
import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, type IChartApi, type DeepPartial, type ISeriesApi, type Time, type TimeChartOptions, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { price, usd } from "@/lib/format";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
const RES = ["1s", "15s", "1m", "5m", "15m", "1h"] as const;

/**
 * Graphique en chandeliers (TradingView Lightweight Charts) aux couleurs de Vigil.
 * Bougies GMGN (historique complet) ; pour un token de quelques secondes, bougies tirées des trades.
 */
export default function PriceChart({ mint, supply, createdAt }: { mint: string; supply: number | null; createdAt?: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vols = useRef<ISeriesApi<"Histogram"> | null>(null);
  // Période par défaut selon l'âge : 30 s pour un token tout neuf, 1 min sous 6 h, 5 min au-delà
  const ageMs = createdAt ? Date.now() - createdAt : null;
  const [res, setRes] = useState<(typeof RES)[number]>(ageMs == null || ageMs < 3_600_000 ? "1s" : ageMs < 6 * 3_600_000 ? "1m" : "5m");
  const [mode, setMode] = useState<"price" | "mcap">("price");
  const picked = useRef(false); // l'utilisateur a choisi une période : on ne la change plus
  useEffect(() => {
    if (picked.current || !createdAt) return;
    const a = Date.now() - createdAt;
    setRes(a < 3_600_000 ? "1s" : a < 6 * 3_600_000 ? "1m" : "5m");
  }, [createdAt]);
  const [source, setSource] = useState<string>("");
  const [empty, setEmpty] = useState(false);
  const fitted = useRef(false);

  // Création du graphique
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#A6A1B8", fontFamily: "JetBrains Mono, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(36,33,46,.55)" }, horzLines: { color: "rgba(36,33,46,.55)" } },
      rightPriceScale: { borderColor: "#24212E", scaleMargins: { top: 0.12, bottom: 0.24 } },
      timeScale: { borderColor: "#24212E", timeVisible: true, secondsVisible: true, rightOffset: 6, barSpacing: 9, minBarSpacing: 3 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#B57BFF", labelBackgroundColor: "#9232F1" }, horzLine: { color: "#B57BFF", labelBackgroundColor: "#9232F1" } },
      // Heure de l'utilisateur (la librairie affiche l'UTC par défaut : 15:23 au lieu de 16:23 en France)
      localization: {
        priceFormatter: (p: number) => (Math.abs(p) >= 1000 ? usd(p) : price(p)),
        timeFormatter: (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      },
    });
    c.applyOptions({
      timeScale: {
        tickMarkFormatter: (t: Time) => {
        const d = new Date((t as number) * 1000);
        return d.getSeconds() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        },
      },
    } as DeepPartial<TimeChartOptions>);
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: "#07E7C3",
      downColor: "#FF4545",
      borderUpColor: "#07E7C3",
      borderDownColor: "#FF4545",
      wickUpColor: "#07E7C3",
      wickDownColor: "#FF4545",
      priceFormat: { type: "price", precision: 10, minMove: 1e-10 },
    });
    vols.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  // Données (rafraîchies toutes les 10 s)
  useEffect(() => {
    let alive = true;
    fitted.current = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/kline/${mint}?res=${res}`);
        if (!r.ok) return;
        const j = (await r.json()) as { source: string; candles: Candle[] };
        if (!alive || !candles.current || !vols.current) return;
        const k = mode === "mcap" && supply ? supply : 1;
        const raw = j.candles.filter((c) => c.open > 0 && c.close > 0).sort((a, b) => a.time - b.time);
        // Chaque bougie ouvre au prix de clôture de la précédente (comme TradingView) :
        // pas de bougies plates invisibles quand une seconde ne compte qu'un trade, et une courbe continue.
        const rows = raw.map((c, i) => {
          if (i === 0 || j.source === "gmgn") return c;
          const open = raw[i - 1].close;
          return { ...c, open, high: Math.max(c.high, open), low: Math.min(c.low, open) };
        });
        candles.current.setData(rows.map((c) => ({ time: c.time as UTCTimestamp, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k })));
        vols.current.setData(rows.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(7,231,195,.35)" : "rgba(255,69,69,.35)" })));
        setSource(j.source);
        setEmpty(rows.length === 0);
        // Beaucoup de bougies : tout afficher ; peu de bougies : largeur fixe, calées à droite (pas de bougie géante)
        if (!fitted.current && rows.length) {
          if (rows.length > 60) chart.current?.timeScale().fitContent();
          else chart.current?.timeScale().scrollToRealTime();
          fitted.current = true;
        }
      } catch {}
    };
    load();
    const t = setInterval(load, res === "1s" || res === "15s" ? 2_000 : 10_000); // 1 s : rafraîchi toutes les 2 s
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint, res, mode, supply]);

  return (
    <div className="pchart">
      <div className="pc-bar">
        <div className="tabs2" role="tablist" aria-label="Timeframe">
          {RES.map((r) => (
            <button key={r} role="tab" aria-selected={res === r} onClick={() => { picked.current = true; setRes(r); }}>{r}</button>
          ))}
        </div>
        <div className="tabs2" role="tablist" aria-label="Scale">
          <button role="tab" aria-selected={mode === "price"} onClick={() => setMode("price")}>Price</button>
          <button role="tab" aria-selected={mode === "mcap"} onClick={() => setMode("mcap")} disabled={!supply}>MCap</button>
        </div>
        <span className="sp" />
        <span className="mut" style={{ fontSize: 11 }}>{source === "gmgn" ? "candles: GMGN" : source === "chain" ? "live from on-chain trades" : ""}</span>
      </div>
      <div className="pc-box" ref={box}>
        {empty && <p className="pc-empty">Waiting for the first trades…</p>}
      </div>
    </div>
  );
}
