"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { brand } from "@/brand.config";
import { VMark } from "./ui";
import WalletButton from "./WalletButton";

const NAV: { href: string; label: string; m?: string; desktopOnly?: boolean }[] = [
  { href: "/app", label: "Scan" },
  { href: "/lens", label: "Lens" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/rewards", label: "Rewards" },
  { href: "/fees", label: "Fees" },
  { href: "/verify", label: "Verify" },
  { href: "/docs", label: "Docs", desktopOnly: true },
];

import OpeningOverlay from "./OpeningOverlay";
import { startOpening } from "@/lib/client/opening";
import { holdScans } from "@/lib/client/scans";

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const on = (href: string) => (href === "/app" ? path === "/app" || path.startsWith("/token") : path.startsWith(href));

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
      startOpening({ mint: v });
      router.push(`/token/${v}`);
      setQ("");
    }
  };

  return (
    <>
      <header className="top">
        <div className="top-in">
          <Link className="logo" href="/" aria-label={`${brand.name} home`}>
            <VMark id="vg-top" />
            <span>{brand.name}</span>
          </Link>
          <nav className="tabs" aria-label="App">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={on(n.href) ? "on" : undefined} onClick={() => holdScans()}>
                {n.label}
              </Link>
            ))}
          </nav>
          <form className="search" onSubmit={go} role="search">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paste a contract address to scan it" aria-label="Contract address" spellCheck={false} />
          </form>
          <WalletButton />
        </div>
      </header>
      <main className="page">{children}</main>
      <OpeningOverlay />
      <nav className="mtabs" aria-label="App">
        {NAV.filter((n) => !n.desktopOnly).map((n) => (
          <Link key={n.href} href={n.href} className={on(n.href) ? "on" : undefined} onClick={() => holdScans()}>
            {n.m ?? n.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
