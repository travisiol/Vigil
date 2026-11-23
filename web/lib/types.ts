export type Verdict = "clean" | "watch" | "bundled";

export type Market = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  priceUsd: number | null;
  mcap: number | null;
  liquidity: number | null;
  change1h: number | null;
  change24h: number | null;
  volume24h: number | null;
  pairAddress: string | null;
  dexId: string | null;
  createdAt: number | null;
  curvePct?: number | null; // progression de la bonding curve pump.fun (0–1)
  raisedUsd?: number | null; // argent réel entré dans la courbe ($)
  dev?: DevInfo | null;
  scan?: ScanLite | null; // verdict déjà calculé par le serveur (flux New pairs)
  early?: { share: number; ageS: number } | null; // part du supply achetée dans les premières secondes (lue sur la courbe)
};

/** Verdict compact livré avec chaque ligne du flux. depth "memory" = jugé sur la mémoire du dev, sans scan. */
export type ScanLite = {
  mint: string;
  verdict: Verdict;
  reason: string;
  depth: "quick" | "full" | "memory";
  checkedAt: number;
  signals: { top10Pct: number | null; early10s: { pct: number | null }; dev: { holdsPct: number | null } };
};

export type DevInfo = {
  launches24h: number;
  launches7d?: number;
  farm: number;
  funder: string | null;
  fresh: boolean | null;
  traced: boolean;
  watchingSince: number;
};

export type Reason = { level: Verdict; text: string };

export type Scan = {
  mint: string;
  verdict: Verdict;
  reason: string;
  reasons: Reason[];
  checkedAt: number;
  decimals: number;
  signals: {
    holdersMeasured: boolean;
    early10s: { pct: number | null; wallets: number | null; traced: boolean; snipers: number | null };
    topWallet: { pct: number; owner: string } | null;
    top10Pct: number | null;
    dev: { address: string | null; boughtPct: number | null; holdsPct: number | null; sold: boolean | null };
    mintAuthority: boolean;
    freezeAuthority: boolean;
    liquidityToMcap: number | null;
    poolsExcluded: number;
    /** Wallets reliés par un financeur commun (hors exchanges) : la trace d'un bundle. */
    clusters: { funder: string; wallets: number; pct: number; devLinked: boolean; fresh: number }[];
    walletsTraced: number;
    devMemory: DevInfo | null;
    gmgn: GmgnSignals | null;
  };
  depth: "quick" | "full";
  /** Les 20 plus gros détenteurs. group = leur financeur commun quand ils font partie d'un cluster. */
  holders: { owner: string; pct: number; pool: boolean; dev: boolean; early: boolean; group: string | null }[];
  market: Market | null;
};

export type SwapQuote = {
  tx: string; // base64, non signée
  side: "buy" | "sell";
  inAmount: string;
  outAmount: string;
  minOut: string;
  feeLamports: string;
  priceImpactPct: number | null; // null = inconnu
  networkFeeLamports?: string; // frais réseau + priorité, payés au réseau (pas à Vigil)
  lastValidBlockHeight: number | null;
};

/** Signaux GMGN (couche rapide du scan) : parts en 0–1. */
export type GmgnSignals = {
  devAddress: string | null;
  devLaunches: number | null; // tokens lancés par ce dev, depuis toujours
  devStatus: "hold" | "sold" | null;
  devFunder: string | null;
  bundlerPct: number | null;
  insiderPct: number | null;
  ratPct: number | null;
  sniperCount: number | null;
  bundlerWallets: number | null;
  freshWalletPct: number | null;
  devTeamPct: number | null;
  rugRatio: number | null;
  washTrading: boolean | null;
  socials: { x: string | null; website: string | null; telegram: string | null };
};
