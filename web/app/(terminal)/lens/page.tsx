import Link from "next/link";
import { Pill } from "@/components/ui";

export const metadata = { title: "Vigil Lens" };

const SITES = [
  { name: "pump.fun", where: "every coin card and coin page" },
  { name: "Axiom", where: "every token row and token page" },
  { name: "GMGN", where: "every token link and token page" },
  { name: "DexScreener", where: "every pair, converted to its token" },
  { name: "X", where: "every tweet that posts a contract address" },
  { name: "Padre · Photon · BullX", where: "beta: token pages and token links" },
];

/** Page d'installation de Vigil Lens (F-080). Chrome Web Store en attente : installation manuelle en 4 étapes. */
export default function Page() {
  return (
    <article className="lens">
      <div className="lens-hero">
        <span className="eyebrow mono">VIGIL · BROWSER EXTENSION · FREE</span>
        <h1>See the rug <span className="grad-text">before you click.</span></h1>
        <p className="mut">
          Vigil puts a rug verdict next to every Solana token on Axiom, GMGN, pump.fun, DexScreener, X, and in beta on Padre, Photon and BullX. Hover it for the reason. Click it for the full scan and the exit radar.
        </p>
        <div className="lens-badges" aria-label="The three verdicts">
          <Pill v="clean" /> <Pill v="watch" /> <Pill v="bundled" />
        </div>
        <div className="cta">
          <a className="btn btn-main" href="/vigil-lens.zip" download>Download the extension</a>
          <Link className="btn btn-ghost" href="/app">Scan a token on the web</Link>
        </div>
        <p className="mut lens-note">Works in Chrome, Brave, Edge, Arc and Opera. Chrome Web Store listing on the way: until then, it installs in four steps.</p>
      </div>

      <section className="lens-grid">
        <div className="card lens-card">
          <h2>Install in 4 steps</h2>
          <ol className="lens-steps">
            <li><b>Download</b> the file above and unzip it. You get a folder named <code>vigil-lens</code>.</li>
            <li>Open <code>chrome://extensions</code> in a new tab.</li>
            <li>Turn on <b>Developer mode</b>, top right.</li>
            <li>Click <b>Load unpacked</b> and pick the <code>vigil-lens</code> folder. Pin the V to your toolbar.</li>
          </ol>
        </div>
        <div className="card lens-card">
          <h2>Where it works</h2>
          <ul className="lens-sites">
            {SITES.map((s) => (
              <li key={s.name}><b>{s.name}</b><span className="mut">{s.where}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lens-grid">
        <div className="card lens-card">
          <h2>What the badge reads</h2>
          <ul className="lens-list">
            <li><b>The first 10 seconds.</b> How much of the supply was taken before a real crowd could even see the token.</li>
            <li><b>The dev.</b> Their past launches, what they bought, whether they sold.</li>
            <li><b>Funding links.</b> Wallets funded by the same source are one player, even if they look like ten.</li>
            <li><b>The exit radar.</b> What the launch wallets still hold right now, and whether they are dumping together.</li>
          </ul>
          <Link className="lens-more" href="/docs">Every rule in the Docs →</Link>
        </div>
        <div className="card lens-card">
          <h2>Read-only, by design</h2>
          <ul className="lens-list">
            <li><b>No wallet access.</b> Lens never asks to connect a wallet and never signs anything.</li>
            <li><b>Only token addresses.</b> The only thing sent to Vigil is the token addresses shown on your screen.</li>
            <li><b>Free plan.</b> Badges, reasons and the token panel, with no account. Pro adds funding traces, the live exit radar and alerts: <a href="/#pricing" style={{ textDecoration: "underline" }}>see the plans</a>.</li>
          </ul>
          <Link className="lens-more" href="/docs">How Vigil reads a token →</Link>
        </div>
      </section>
    </article>
  );
}
