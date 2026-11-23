"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/brand.config";
import { quote, signAndSend } from "@/lib/client/trade";
import { holdScans, isUpgrading, useScans } from "@/lib/client/scans";
import { startOpening } from "@/lib/client/opening";
import { age, pct, price, short, toRaw, usd } from "@/lib/format";
import type { Market } from "@/lib/types";
import FilterPanel, { activeCount, DEAD_BELOW_USD, isDead, isSerial, passes, useFilters } from "./Filters";
import { Pill, TokenIcon } from "./ui";

type Row = Market & { creator?: string };
type Tab = "new" | "final" | "migrated" | "trending";
const URL_OF: Record<Tab, string> = { new: "/api/new", final: "/api/pulse?list=final", migrated: "/api/pulse?list=migrated", trending: "/api/trending" };
const EVERY: Record<Tab, number> = { new: 3_000, final: 5_000, migrated: 8_000, trending: 30_000 };
type Sort = "volume" | "new" | "mcap";

const SCAN_AFTER_MS = 12_000;

/**
 * Sur Vercel, chaque rafraîchissement peut venir d'une copie différente du serveur, avec sa propre liste
 * (12 tokens, puis 45, puis 12…). On fusionne au lieu de remplacer : un token reste affiché tant qu'il a moins
 * de 4 min, et garde le verdict le plus complet reçu (scan complet > rapide > premier regard).
 */
const DEPTH: Record<string, number> = { memory: 1, quick: 2, full: 3 };
function mergeRows(prev: Row[] | null, next: Row[], keepMs = 4 * 60_000): Row[] {
  const now = Date.now();
  const by = new Map<string, Row>();
  for (const r of prev ?? []) if (!r.createdAt || now - r.createdAt < keepMs) by.set(r.mint, r);
  for (const r of next) {
    const old = by.get(r.mint);
    if (!old) {
      by.set(r.mint, r);
      continue;
    }
    const os = old.scan, ns = r.scan;
    const scan = !ns ? os : !os ? ns : (DEPTH[ns.depth] ?? 0) >= (DEPTH[os.depth] ?? 0) ? ns : os;
    by.set(r.mint, { ...old, ...r, scan, early: r.early ?? old.early, dev: r.dev ?? old.dev, image: r.image ?? old.image, name: r.name || old.name });
  }
  return [...by.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 120);
} // on attend que les 10 premières secondes soient passées
const SCAN_TOP = 15; // nouvelles paires scannées automatiquement (les autres : au clic)

function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const liveAge = (createdAt: number | null, now: number | null) => {
  if (!createdAt || !now) return "–";
  const s = Math.max(0, Math.floor((now - createdAt) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60 < 10 ? "0" : ""}${s % 60}s` : age(createdAt);
};

export default function Discover() {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [tab, setTab] = useState<Tab>("new");
  const [lists, setLists] = useState<Record<Tab, Row[] | null>>({ new: null, final: null, migrated: null, trending: null });
  const [updatedAt, setUpdatedAt] = useState<Record<Tab, number>>({ new: 0, final: 0, migrated: 0, trending: 0 });
  const [err, setErr] = useState(false);
  const [sort, setSort] = useState<Sort>("volume");
  const [filters, setFilters] = useFilters("vigil.filters.v2");
  const [showFilters, setShowFilters] = useState(false);
  const [size, setSize] = useState<number>(brand.trade.buyPresetsSol[1]);
  const [sweepKey, setSweepKey] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string; sig?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Set<string>>(new Set());
  const now = useNow();

  // Pause au survol : la liste se fige pour pouvoir lire, les nouveautés attendent (comme Axiom)
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const buffered = useRef<Row[] | null>(null);
  const [waitingNew, setWaitingNew] = useState(0);

  const load = useCallback(async (t: Tab) => {
    try {
      const r = await fetch(URL_OF[t]);
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { tokens: Row[] };
      if (t === "new" && pausedRef.current) {
        buffered.current = j.tokens;
        setWaitingNew(j.tokens.filter((x) => !seen.current.has(x.mint)).length);
        // les verdicts des lignes déjà affichées se mettent quand même à jour
        const byMint = new Map(j.tokens.map((x) => [x.mint, x]));
        setLists((l) => ({ ...l, new: (l.new ?? []).map((x) => ({ ...x, ...(byMint.get(x.mint) ? { scan: byMint.get(x.mint)!.scan, mcap: byMint.get(x.mint)!.mcap, curvePct: byMint.get(x.mint)!.curvePct, raisedUsd: byMint.get(x.mint)!.raisedUsd, dev: byMint.get(x.mint)!.dev } : {}) })) }));
        return;
      }
      if (t === "new") {
        const first = seen.current.size === 0;
        const added = new Set(j.tokens.map((x) => x.mint).filter((m) => !seen.current.has(m)));
        j.tokens.forEach((x) => seen.current.add(x.mint));
        setFresh(first ? new Set() : added);
      } else if (t === "trending") setSweepKey((k) => k + 1);
      setLists((l) => ({ ...l, [t]: t === "new" ? mergeRows(l.new, j.tokens) : j.tokens }));
      setUpdatedAt((u) => ({ ...u, [t]: Date.now() }));
      setErr(false);
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    load(tab);
    const t = setInterval(() => load(tab), EVERY[tab]);
    return () => clearInterval(t);
  }, [tab, load]);

  const setPause = (p: boolean) => {
    if (tab !== "new") return;
    pausedRef.current = p;
    setPaused(p);
    if (!p && buffered.current) {
      const next = buffered.current;
      buffered.current = null;
      setWaitingNew(0);
      // (fusion aussi à la reprise après la pause)
      const added = new Set(next.map((x) => x.mint).filter((m) => !seen.current.has(m)));
      next.forEach((x) => seen.current.add(x.mint));
      setFresh(added);
      setLists((l) => ({ ...l, new: mergeRows(l.new, next) }));
    }
  };

  const tokens = lists[tab];

  // L'entonnoir (ENGINE.md §2.7) :
  // 1) les paires mortes (moins de 1 k$ levés après 90 s) ne coûtent rien : ni scan, ni affichage par défaut
  // 2) scan rapide pour les vivantes, dès leurs 10 premières secondes passées
  // 3) scan complet (financements) seulement pour celles qui attirent de l'argent réel, ou à la demande
  // Nouvelles paires : le serveur scanne déjà chaque lancement vivant et livre le verdict avec la ligne.
  // Ici on ne demande que les scans complets à la main ("Scan"). En tendance : scan rapide de chaque ligne.
  const { quickScan, fullScan, dead, spam } = useMemo(() => {
    if (!tokens) return { quickScan: [], fullScan: [], dead: 0, spam: 0 };
    if (tab === "trending") return { quickScan: tokens.map((t) => t.mint), fullScan: [], dead: 0, spam: 0 };
    const at = Date.now();
    if (tab !== "new") return { quickScan: tab === "migrated" ? tokens.filter((t) => !t.scan).map((t) => t.mint) : [], fullScan: [...manual], dead: 0, spam: tokens.filter((t) => isSerial(t)).length };
    return { quickScan: [], fullScan: [...manual], dead: tokens.filter((t) => isDead(t, at)).length, spam: tokens.filter((t) => isSerial(t)).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, tab, manual, now && Math.floor(now / 4000)]);
  const getClientScan = useScans(quickScan, fullScan);
  // Le verdict le plus complet disponible : scan demandé ici, sinon celui livré par le serveur
  const getScan = (mint: string, row?: Row) => {
    const c = getClientScan(mint);
    if (c && typeof c === "object") return c;
    const served = row?.scan ?? tokens?.find((x) => x.mint === mint)?.scan;
    return served ?? c;
  };

  const rows = useMemo(() => {
    const list = [...(tokens ?? [])];
    if (tab === "trending") {
      if (sort === "new") list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      if (sort === "mcap") list.sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0));
    }
    const at = now ?? 0;
    return list.filter((t) => {
      const s = getScan(t.mint, t);
      return passes(t, s && typeof s === "object" ? s : null, filters, at);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, tab, sort, filters, getClientScan, now]);
  const nFilters = activeCount(filters);

  const counts = useMemo(() => {
    let scanned = 0, bundled = 0, clean = 0;
    for (const t of tokens ?? []) {
      const s = getScan(t.mint, t);
      if (s && typeof s === "object") {
        scanned++;
        if (s.verdict === "bundled") bundled++;
        if (s.verdict === "clean") clean++;
      }
    }
    return { scanned, bundled, clean };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, getClientScan]);

  // Au survol d'une ligne, on prépare la page du token (scan rapide, prix, bougies) : au clic, tout est déjà prêt
  const warmed = useRef<Set<string>>(new Set());
  const warm = (mint: string) => {
    if (warmed.current.has(mint)) return;
    warmed.current.add(mint);
    router.prefetch(`/token/${mint}`);
    fetch(`/api/scan/${mint}?depth=quick`).catch(() => {});
    fetch(`/api/market/${mint}`).catch(() => {});
    fetch(`/api/pair/${mint}`).catch(() => {});
  };

  const quickBuy = async (t: Row) => {
    if (!publicKey || !signTransaction) return setVisible(true);
    setBusy(t.mint);
    setToast(null);
    try {
      const q = await quote({ side: "buy", mint: t.mint, amount: toRaw(String(size), 9), taker: publicKey.toBase58(), slippageBps: brand.trade.defaultSlippageBps });
      const res = await signAndSend(q, signTransaction);
      setToast(res.status === "failed" ? { kind: "err", text: "Buy failed on-chain.", sig: res.signature } : { kind: "ok", text: `Bought ${t.symbol} for ${size} SOL${res.status === "pending" ? " (still confirming)" : ""}.`, sig: res.signature });
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : brand.copy.error });
    } finally {
      setBusy(null);
    }
  };

  const ago = updatedAt[tab] && now ? Math.max(0, Math.round((now - updatedAt[tab]) / 1000)) : null;

  return (
    <>
      <div className="disc-head">
        <div>
          <h1>Discover</h1>
          <p className="mut">
            {tab === "new" ? "Every pump.fun launch, read straight from the chain and scanned once its first 10 seconds are over."
              : tab === "final" ? "Tokens past 40% of their bonding curve, about to migrate. Each one gets Vigil's full scan, funding links included."
              : tab === "migrated" ? "Tokens that completed their bonding curve in the last 6 hours, with the verdict Vigil gave them at launch."
              : "The Solana tokens trading most right now, each one scanned."}
          </p>
        </div>
        <div className="counters" aria-live="polite">
          <div><b className="mono">{counts.scanned}</b><span>scanned</span></div>
          <div><b className="mono" style={{ color: "var(--ok)" }}>{counts.clean}</b><span>clean</span></div>
          <div><b className="mono grad-text">{counts.bundled}</b><span>bundles flagged</span></div>
        </div>
      </div>

      {toast && (
        <p className={`msg ${toast.kind}`} role="status" style={{ marginBottom: 14 }}>
          {toast.text} {toast.sig && <a href={`https://solscan.io/tx/${toast.sig}`} target="_blank" rel="noreferrer">View transaction</a>}
        </p>
      )}

      <div className="card beam">
        <div className="bar">
          <div className="seg2" role="tablist" aria-label="Lists">
            <button role="tab" aria-selected={tab === "new"} onClick={() => setTab("new")}>
              <span className="dotlive" aria-hidden="true" />New pairs
            </button>
            <button role="tab" aria-selected={tab === "final"} onClick={() => setTab("final")}>Final stretch</button>
            <button role="tab" aria-selected={tab === "migrated"} onClick={() => setTab("migrated")}>Migrated</button>
            <button role="tab" aria-selected={tab === "trending"} onClick={() => setTab("trending")}>Trending</button>
          </div>
          {tab === "trending" &&
            (["volume", "new", "mcap"] as Sort[]).map((s) => (
              <button key={s} className="chip" aria-pressed={sort === s} onClick={() => setSort(s)}>
                {s === "volume" ? "Top volume" : s === "new" ? "Newest" : "Market cap"}
              </button>
            ))}
          <button
            className="chip"
            aria-pressed={!filters.verdicts.bundled}
            onClick={() => setFilters({ ...filters, verdicts: { ...filters.verdicts, bundled: !filters.verdicts.bundled } })}
          >
            Hide bundled
          </button>
          <button className="chip" aria-pressed={showFilters} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            Filters {nFilters > 0 && <span className="fbadge">{nFilters}</span>}
          </button>
          <span className="sp" />
          {tab === "new" && paused && <span className="chip paused">Paused{waitingNew ? ` · ${waitingNew} new` : ""}</span>}
          {tab === "new" && filters.hideDead && dead > 0 && (
            <button className="chip" title="Pairs under $1K raised after 90 s" onClick={() => setFilters({ ...filters, hideDead: false })}>
              {dead} dead hidden
            </button>
          )}
          {tab !== "trending" && filters.hideSerial && spam > 0 && (
            <button className="chip" title="Serial devs and dev farms" onClick={() => setFilters({ ...filters, hideSerial: false })}>
              {spam} spam hidden
            </button>
          )}
          <span className="upd mono">{ago == null ? "" : ago < 2 ? "live" : `${ago}s ago`}</span>
          <label htmlFor="qb">Quick buy</label>
          {brand.trade.buyPresetsSol.map((v) => (
            <button key={v} id={v === brand.trade.buyPresetsSol[0] ? "qb" : undefined} className="chip mono" aria-pressed={size === v} onClick={() => setSize(v)}>
              {v} SOL
            </button>
          ))}
        </div>
        {showFilters && <FilterPanel f={filters} set={setFilters} />}
        <div className="tbl-wrap" onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)}>
          {tab === "trending" && tokens && <div key={sweepKey} className="sweep" aria-hidden="true" />}
          <table className="tbl">
            <thead>
              <tr>
                <th>Token</th>
                <th className="r">{tab !== "trending" ? "Age" : "Price"}</th>
                <th className="r">MCap</th>
                {tab !== "trending" ? <th className="hide-m">Dev</th> : <th className="r hide-m">Liquidity</th>}
                {tab === "trending" && <th className="r hide-m">1h</th>}
                {tab === "trending" && <th className="r hide-m">Vol 24h</th>}
                <th>Scan</th>
                <th className="hide-m">Why</th>
                <th className="r" />
              </tr>
            </thead>
            <tbody>
              {!tokens && !err &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="skel">
                    {Array.from({ length: tab !== "trending" ? 7 : 9 }, (_, j) => <td key={j}><div /></td>)}
                  </tr>
                ))}
              {rows.map((t) => {
                const s = getScan(t.mint, t);
                const young = tab === "new" && t.createdAt && now != null && now - t.createdAt < SCAN_AFTER_MS;
                const deadRow = tab === "new" && now != null && isDead(t, now);
                // Une paire morte n'est pas scannée d'office : bouton "Scan" pour la vérifier quand même
                const queued = tab === "new" && !s && !young && deadRow;
                // Un verdict déjà livré (premier regard dès ~8 s, ou scan) s'affiche tout de suite, même si le token est très jeune
                const v = s && typeof s === "object" ? s.verdict : young ? "scanning" : !s ? (queued ? "unknown" : "scanning") : s === "pending" ? "scanning" : s === "error" ? "unknown" : "scanning";
                const why =
                  typeof s === "object"
                    ? s.reason +
                      (isUpgrading(t.mint) ? " · tracing funding…" : s.depth === "quick" && tab !== "trending" ? " · quick scan" : s.depth === "memory" ? " · from Vigil's dev memory" : "")
                  : deadRow ? "Dead: under $1K raised after 90 s"
                  : young ? (t.early ? `${(t.early.share * 100).toFixed(1)}% bought in ${t.early.ageS} s… watching the first 10 s` : "Watching the first 10 seconds…")
                  : s === "pending" ? "Reading the chain…"
                  : s === "error" ? "Could not read this token right now"
                  : tab === "new" && (t.raisedUsd ?? 0) < 300 && (t.curvePct ?? 0) < 0.01 ? "Waiting for real buyers (under $300 in)"
                  : tab === "new" ? "In Vigil's scan queue…"
                  : tab === "final" ? "Full scan running: tracing who funded the early buyers…"
                  : tab === "migrated" ? "Scanning…"
                  : "Click Scan to check it";
                return (
                  <tr key={t.mint} className={`${fresh.has(t.mint) ? "new " : ""}v-${typeof s === "object" ? s.verdict : "none"}`} onClick={() => { startOpening({ mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, verdict: typeof s === "object" && s ? s.verdict : null }); holdScans(); router.push(`/token/${t.mint}`); }} onMouseEnter={() => warm(t.mint)}>
                    <td>
                      <div className="tok">
                        <TokenIcon src={t.image} alt="" symbol={t.symbol} />
                        <div><b>{t.symbol}</b><span>{t.name}</span></div>
                      </div>
                    </td>
                    <td className="r mono">{tab !== "trending" ? <span className={young ? "grad-text" : undefined}>{liveAge(t.createdAt, now)}</span> : price(t.priceUsd)}</td>
                    <td className="r mono">
                      {usd(t.mcap)}
                      {tab !== "trending" && t.curvePct != null && (
                        <span className="curve" title={`Bonding curve ${Math.round(t.curvePct * 100)}%`}>
                          <i style={{ width: `${Math.max(2, t.curvePct * 100)}%` }} />
                        </span>
                      )}
                    </td>
                    {tab !== "trending" ? (
                      <td className="hide-m">
                        <span className="mono mut">{t.creator ? short(t.creator) : "–"}</span>
                        {t.dev && t.dev.launches24h >= 2 && <span className={`tag ${t.dev.launches24h >= 3 ? "bundle" : "dev"}`} title="Tokens this wallet launched in 24 h, seen by Vigil">×{t.dev.launches24h} launches</span>}
                        {t.dev && t.dev.farm >= 1 && <span className={`tag ${t.dev.farm >= 2 ? "bundle" : "dev"}`} title="Other dev wallets funded by the same wallet">farm +{t.dev.farm}</span>}
                        {t.dev?.fresh && <span className="tag dev" title="Dev wallet created less than 1 hour before launch">new wallet</span>}
                      </td>
                    ) : (
                      <td className="r mono hide-m">{t.dexId === "pumpfun" ? <span className="mut">curve</span> : usd(t.liquidity)}</td>
                    )}
                    {tab === "trending" && <td className={`r mono hide-m ${(t.change1h ?? 0) >= 0 ? "up" : "dn"}`}>{pct(t.change1h)}</td>}
                    {tab === "trending" && <td className="r mono hide-m">{usd(t.volume24h)}</td>}
                    <td key={String(v)} className={v !== "scanning" && v !== "unknown" ? "flash" : undefined}>
                      {queued ? (
                        <button className="chip" onClick={(e) => { e.stopPropagation(); setManual((m) => new Set(m).add(t.mint)); }}>Scan</button>
                      ) : (
                        <Pill v={v} title={typeof s === "object" ? s.reason : undefined} />
                      )}
                    </td>
                    <td className="hide-m"><div className="why">{why}</div></td>
                    <td className="r">
                      <button className="qbuy" disabled={busy === t.mint} onClick={(e) => { e.stopPropagation(); quickBuy(t); }}>
                        {busy === t.mint ? "…" : <>Buy<span className="hide-m"> {size}</span></>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {err && !tokens && <p className="empty">{brand.copy.error}</p>}
          {tokens && !rows.length && (
            <p className="empty">
              {tab === "final" ? "No token past 40% of its curve right now. Vigil follows every launch: they show up here as they climb."
                : tab === "migrated" ? "No migration seen yet. Vigil follows every launch from its first second: migrations show up here as they happen."
                : brand.copy.empty}
            </p>
          )}
        </div>
      </div>
      <p className="mut" style={{ fontSize: 12, marginTop: 12 }}>
        Facts from the chain, not financial advice. A {brand.fees.tradeFeeBps / 100}% fee is included in every trade and shown before you sign, {brand.fees.cashbackPct}% of it comes back to you.
      </p>
    </>
  );
}
