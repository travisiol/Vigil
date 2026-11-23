/**
 * brand.config.ts — Vigil. LE SEUL fichier à modifier pour rebrander.
 * Tout ce qui est public est en anglais [F-020]. Logo validé [F-035]. Palette tirée du logo [F-037], fond noir [F-038].
 */

export const brand = {
  name: "Vigil",
  tagline: "Always on watch.",
  description:
    "A free browser extension that flags rugs on Axiom, GMGN, pump.fun, DexScreener and X. Every bundle, insider and serial dev, flagged before you click.",
  domain: "vigil.trade",
  ticker: "$VIGIL",
  contract: "", // CA du token $VIGIL, vide tant qu'il n'est pas lancé

  logo: { icon: "/brand/icon.png" },

  // Palette 15 "Vigil Glow" (PALETTES.md)
  palette: {
    bg: "#000000",
    surface: "#0B0A0F",
    "surface-2": "#13111A",
    border: "#24212E",
    text: "#F5F3FA",
    muted: "#A6A1B8",
    primary: "#9232F1",
    magenta: "#BC33C9",
    accent: "#F22C7B",
    "primary-text": "#B57BFF",
    success: "#07E7C3", // Clean
    warning: "#FFB21F", // Watch
    danger: "#FF4545", // Bundled
  },
  gradient: "linear-gradient(135deg, #9232F1 0%, #BC33C9 50%, #F22C7B 100%)",

  fonts: { display: "Sora", body: "Inter", mono: "JetBrains Mono" },

  socials: { x: "https://x.com/vigiltrade", telegram: "", discord: "" },

  copy: {
    scanLabels: { clean: "Clean", watch: "Watch", bundled: "Bundled", scanning: "Scanning" },
    empty: "All quiet. Vigil is watching.",
    error: "Vigil lost the signal. Retry.",
  },

  // Seuils du scan (ARCHITECTURE.md)
  scan: {
    early10sBundled: 0.3,
    topWalletBundled: 0.2,
    top10Watch: 0.4,
    liquidityWatch: 0.05,
  },

} as const;

export type Brand = typeof brand;
