"use client";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";
import { share, short } from "@/lib/format";
import type { Scan } from "@/lib/types";

type Node = SimulationNodeDatum & { id: string; r: number; color: string; label: string; pct: number; kind: string };

type SimLink = { source: string | Node; target: string | Node };

const COLORS ={ pool: "#3A3547", dev: "#FFB21F", bundle: "#FF4545", early: "#F22C7B", holder: "#9232F1" };

/**
 * Bubble map des 20 plus gros détenteurs : taille = part du supply.
 * Rouge = wallets qui ont acheté dans le même bloc au lancement (reliés entre eux), ambre = le dev, gris = pools.
 */
export default function BubbleMap({ scan }: { scan: Scan | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 420 });
  const [nodes, setNodes] = useState<Node[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; n: Node } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { base, links } = useMemo(() => {
    const hs = scan?.holders ?? [];
    const max = Math.max(...hs.map((h) => h.pct), 0.0001);
    const base: Node[] = hs.map((h) => {
      const kind = h.pool ? "pool" : h.dev ? "dev" : h.group != null ? "bundle" : h.early ? "early" : "holder";
      return { id: h.owner, r: 8 + 46 * Math.sqrt(h.pct / max), color: COLORS[kind as keyof typeof COLORS], label: share(h.pct), pct: h.pct, kind };
    });
    const groups = new Map<string, string[]>();
    for (const h of hs) if (h.group != null) groups.set(h.group, [...(groups.get(h.group) ?? []), h.owner]);
    const links: { source: string; target: string }[] = [];
    for (const ids of groups.values()) for (let i = 1; i < ids.length; i++) links.push({ source: ids[0], target: ids[i] });
    return { base, links };
  }, [scan]);

  useEffect(() => {
    if (!base.length) return setNodes([]);
    const ns = base.map((n) => ({ ...n }));
    const sim = forceSimulation(ns)
      .force("charge", forceManyBody().strength(-18))
      .force("x", forceX(size.w / 2).strength(0.06))
      .force("y", forceY(size.h / 2).strength(0.08))
      .force("collide", forceCollide<Node>().radius((d) => d.r + 3))
      .force(
        "link",
        forceLink<Node, SimLink>(links.map((l) => ({ ...l })))
          .id((d) => d.id)
          .distance((l) => (typeof l.source === "object" ? l.source.r : 20) + (typeof l.target === "object" ? l.target.r : 20) + 8)
          .strength(0.7),
      )
      .stop();
    for (let i = 0; i < 240; i++) sim.tick();
    for (const n of ns) {
      n.x = Math.max(n.r, Math.min(size.w - n.r, n.x ?? 0));
      n.y = Math.max(n.r, Math.min(size.h - n.r, n.y ?? 0));
    }
    setNodes(ns);
  }, [base, links, size]);

  if (!scan) return <p className="empty">Mapping holders…</p>;
  if (!scan.holders.length) return <p className="empty">Holders could not be read for this token.</p>;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="bmap" ref={wrap} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label="Bubble map of the top 20 holders">
        {links.map((l, i) => {
          const a = byId.get(l.source), b = byId.get(l.target);
          return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FF4545" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="4 4" /> : null;
        })}
        {nodes.map((n) => (
          <g key={n.id} onMouseEnter={() => setTip({ x: n.x ?? 0, y: (n.y ?? 0) - n.r, n })} onClick={() => window.open(`https://solscan.io/account/${n.id}`, "_blank")}>
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} fillOpacity={n.kind === "pool" ? 0.5 : 0.28} stroke={n.color} strokeWidth="1.5" />
            {n.r > 20 && (
              <text x={n.x} y={(n.y ?? 0) + 4} textAnchor="middle" fill="#F5F3FA" fontSize="11" fontFamily="var(--f-mono)">{n.label}</text>
            )}
          </g>
        ))}
      </svg>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          <b className="mono">{short(tip.n.id)}</b> · {share(tip.n.pct)}{" "}
          <span className="mut">{tip.n.kind === "pool" ? "pool" : tip.n.kind === "dev" ? "dev" : tip.n.kind === "bundle" ? "funded by the same wallet as others" : tip.n.kind === "early" ? "bought in the first 10 s" : "holder"}</span>
        </div>
      )}
      <div className="legend">
        <span><i style={{ background: COLORS.bundle }} />Same funder (cluster)</span>
        <span><i style={{ background: COLORS.early }} />First 10 s</span>
        <span><i style={{ background: COLORS.dev }} />Dev</span>
        <span><i style={{ background: COLORS.holder }} />Holder</span>
        <span><i style={{ background: COLORS.pool }} />Pool</span>
      </div>
    </div>
  );
}
