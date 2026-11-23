import Link from "next/link";
import { brand } from "@/brand.config";

export const metadata = { title: "Docs" };

const pc = (x: number) => `${Math.round(x * 100)}%`;

export default function Page() {
  const t = brand.scan;
  return (
    <article className="doc">
      <div className="hero-s">
        <h1>How Vigil <span className="grad-text">watches.</span></h1>
        <p className="mut">What Vigil reads on the chain, how a verdict is decided, and how the extension shows it on the sites you already use.</p>
      </div>

      <section>
        <h2>The extension</h2>
        <p>Vigil Lens is a free browser extension. On Axiom, GMGN, pump.fun, DexScreener and X (and in beta on Padre, Photon and BullX), it puts a Clean, Watch or Bundled badge next to every Solana token on your screen. Hover the badge for the reason; click it for the full scan. On a token page, a small panel shows the verdict, the key numbers and the exit radar. <Link href="/lens" style={{ textDecoration: "underline" }}>Get the extension</Link>.</p>
        <p>Lens is read-only: it never touches your wallet, and the only thing it sends to Vigil is the token addresses shown on screen.</p>
      </section>

      <section>
        <h2>Two depths</h2>
        <p>A token is scanned the moment someone looks at it, with Lens or on this site. Results are shared, so the next person sees them instantly.</p>
        <table>
          <thead><tr><th>When</th><th>What Vigil reads</th></tr></thead>
          <tbody>
            <tr><td><b>Quick scan</b><br /><span className="mut">a few seconds</span></td><td>Holders, the dev&apos;s wallet and past launches, mint and freeze authority, liquidity, bundler and insider labels, the share of supply taken at launch.</td></tr>
            <tr><td><b>Full scan</b><br /><span className="mut">when you open a token</span></td><td>Every buy of the first 10 seconds, who funded each of those wallets (two hops back), and which holders are secretly the same person.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>The signals</h2>
        <p>Pools, bonding curves and protocol wallets (accounts run by a program, not a person) are recognised and left out, so only real wallets count.</p>
        <table>
          <thead><tr><th>Signal</th><th>What it means</th></tr></thead>
          <tbody>
            <tr><td><b>Supply taken in the first 10 s</b></td><td>A real crowd can&apos;t buy that fast; a bundle can. Vigil counts the wallets and flags the sniper bots among them.</td></tr>
            <tr><td><b>Dev history</b></td><td>How many tokens the creator&apos;s wallet launched before. 20 or more makes it a <i>serial dev</i>; 5 or more is worth watching. A wallet that funds several dev wallets runs a <i>dev farm</i>, and a dev wallet created less than an hour before launch is flagged too.</td></tr>
            <tr><td><b>Funding links</b></td><td>For the early buyers and top holders, Vigil follows where their SOL came from, two hops back. Wallets funded by the same source are one player, even if they look like ten. If that source also funded the dev, it says so.</td></tr>
            <tr><td><b>Biggest wallet · top 10</b></td><td>How much of the supply the largest holders own right now.</td></tr>
            <tr><td><b>Bundlers, insiders, rat traders</b></td><td>Share of supply held by wallets labelled this way, from GMGN&apos;s data.</td></tr>
            <tr><td><b>Dev</b></td><td>What the creator bought at launch, what it still holds, and whether it sold.</td></tr>
            <tr><td><b>Mint and freeze authority</b></td><td>Whether someone can still create more tokens or freeze yours.</td></tr>
            <tr><td><b>Liquidity vs market cap</b></td><td>How much real money sits in the pool behind the price.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>The verdict</h2>
        <ul>
          <li><b style={{ color: "var(--bad)" }}>Bundled</b>: {pc(t.early10sBundled)} or more of the supply taken in the first 10 seconds; one wallet holding {pc(t.topWalletBundled)} or more; wallets funded by the same source (or by the dev&apos;s funder) holding a large share; bundlers or insiders holding 20% or more; a serial dev or a dev farm.</li>
          <li><b style={{ color: "var(--wa)" }}>Watch</b>: 15% or more taken in the first seconds; mint or freeze authority still active; top 10 wallets holding {pc(t.top10Watch)} or more; liquidity under {pc(t.liquidityWatch)} of market cap; a dev who sold most of the launch buy; a dev with 5 or more past launches; a dev wallet made just before launch.</li>
          <li><b style={{ color: "var(--ok)" }}>Clean</b>: none of the above.</li>
        </ul>
        <p>Every verdict comes with its reason in one sentence. These are facts from the chain, not financial advice: a clean token can still go to zero.</p>
      </section>

      <section>
        <h2>Exit radar</h2>
        <p>A rug is the moment the people who got in first get out. On every token you open, Vigil watches the dev, every wallet that bought in the first 10 seconds, the wallets linked by their funding and the biggest holders, and reads every trade as it happens.</p>
        <ul>
          <li><b>Still holding</b>: what the launch buyers still hold right now, read from their wallets, out of what they bought. It works on old tokens too.</li>
          <li><b>Dev sold</b>: the share of the dev&apos;s bag already sold.</li>
          <li><b>Coordinated sells</b>: three launch wallets or more selling within the same 2 seconds.</li>
        </ul>
        <p>Green: they hold. Orange: they are selling, or most of them are already out. Red: they are dumping right now (the dev sold half of the bag or more, a coordinated sell in the last 10 minutes, or 5% of supply sold in 5 minutes).</p>
      </section>

      <section>
        <h2>Privacy</h2>
        <ul>
          <li><b>No wallet.</b> Vigil never asks to connect a wallet, never signs anything and never sees your funds.</li>
          <li><b>Only token addresses.</b> The extension sends Vigil the token addresses shown on your screen, nothing else: no browsing history, no account, no cookies.</li>
          <li><b>Listed sites only.</b> The extension runs on Axiom, GMGN, pump.fun, DexScreener, X, Padre, Photon and BullX, and nowhere else.</li>
        </ul>
      </section>

      <section>
        <h2>Limits today</h2>
        <ul>
          <li>Tokens with a very long history can&apos;t be traced back to their launch live yet: the 10-second signal then shows &quot;not measured&quot;.</li>
          <li>The full scan runs when you open a token; Lens badges use the quick scan, which takes a few seconds for a token nobody has looked at yet.</li>
          <li>Lens is not on the Chrome Web Store yet: it installs in four steps from the <Link href="/lens" style={{ textDecoration: "underline" }}>extension page</Link>.</li>
        </ul>
      </section>
    </article>
  );
}
