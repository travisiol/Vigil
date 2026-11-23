import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import { brand } from "@/brand.config";
import "./globals.css";
import "./terminal.css";

const display = Sora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-display" });
const body = Inter({ subsets: ["latin"], variable: "--f-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: { default: `${brand.name} · ${brand.tagline}`, template: `%s · ${brand.name}` },
  description: brand.description,
  icons: { icon: brand.logo.icon },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        {/* Le graphique TradingView vient de DexScreener : connexion ouverte d'avance */}
        <link rel="preconnect" href="https://dexscreener.com" />
        <link rel="dns-prefetch" href="https://dexscreener.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
