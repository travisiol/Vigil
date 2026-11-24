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

/** Page d'installation de Vigil Lens (F-080). Installation depuis la fiche Chrome Web Store `[F-129]`. */
const STORE_URL = "https://chromewebstore.google.com/detail/nakiioiplklgongjjhlhikaoojcjgceh";
export default function Page() {
  return (
    <article className="lens">
      <div className="lens-hero">
        <span className="eyebrow mono">VIGIL · BROWSER EXTENSION · FREE</span>
        <h1>See the rug <span className="grad-text">before you click.</span></h1>
        <p className="mut">
          Vigil puts a rug verdict next to every Solana token on Axiom, GMGN, pump.fun, DexScreener, X, and in beta on Padre, Photon and BullX. Click the V next to any token: Vigil reads its launch and seals it in seconds.
        </p>
        <div className="lens-badges" aria-label="The three verdicts">
          <Pill v="clean" /> <Pill v="watch" /> <Pill v="bundled" />
        </div>
        <div className="cta">
          <a className="btn btn-main" href={STORE_URL} target="_blank" rel="noopener">Add to Chrome</a>
          <Link className="btn btn-ghost" href="/app">Scan a token on the web</Link>
        </div>
        <p className="mut lens-note">Free on the Chrome Web Store, checked by Google. Works in Chrome, Brave, Edge, Arc and Opera.</p>
      </div>

      <section className="lens-grid">
        <div className="card lens-card">
          <h2>Install in 4 steps</h2>
          <ol className="lens-steps">
            <li>Open <a href={STORE_URL} target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>Vigil on the Chrome Web Store</a>.</li>
            <li>Click <b>Add to Chrome</b>, then <b>Add extension</b>.</li>
            <li>Pin the V: puzzle icon in the toolbar, then the pin next to Vigil.</li>
            <li>Open your terminal and click the V after any token's name.</li>
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
