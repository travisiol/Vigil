export const metadata = { title: "Privacy" };

/** Politique de confidentialité de l'extension (exigée par le Chrome Web Store) `[F-087]`. */
export default function Page() {
  return (
    <article className="doc">
      <div className="hero-s">
        <h1>Privacy</h1>
        <p className="mut">What the Vigil browser extension and this website collect, and what they don&apos;t. Last updated 23 November 2026.</p>
      </div>

      <section>
        <h2>The short version</h2>
        <p>Vigil reads the Solana token addresses shown on the pages where it runs, sends those addresses to Vigil&apos;s server, and shows you the verdict. That is all it sends. It never reads your wallet, your browsing history, your cookies or anything you type.</p>
      </section>

      <section>
        <h2>What the extension sends</h2>
        <ul>
          <li><b>Token addresses</b> visible on Axiom, GMGN, pump.fun, DexScreener, X, Padre, Photon and BullX, so the server can return a Clean, Watch or Bundled verdict.</li>
          <li>Nothing else: no page content, no URLs of other sites, no identifiers, no account.</li>
        </ul>
      </section>

      <section>
        <h2>What the extension stores</h2>
        <ul>
          <li><b>One setting</b> in your browser&apos;s local storage: the address of the Vigil server to ask. It never leaves your computer.</li>
          <li>Whether you minimised the panel, for the current tab only.</li>
        </ul>
      </section>

      <section>
        <h2>What it never does</h2>
        <ul>
          <li>It never connects to a wallet, never signs anything and never sees your funds.</li>
          <li>It doesn&apos;t run on any site other than the ones listed above.</li>
          <li>It doesn&apos;t sell, share or rent any data, and doesn&apos;t use analytics or advertising trackers.</li>
        </ul>
      </section>

      <section>
        <h2>The server</h2>
        <p>Vigil&apos;s server receives token addresses and reads public Solana data about them. Like any web server, its host may keep standard technical logs (such as IP address and time of the request) for a short time, for security and to keep the service running. Verdicts are shared between users: a token checked once is answered instantly for the next person.</p>
      </section>

      <section>
        <h2>Pro and holder access</h2>
        <p>When paid plans open, checking a $VIGIL balance will read a public wallet address you choose to give. Vigil will never ask for a private key or a seed phrase.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about privacy: reach us on X at @vigiltrade.</p>
      </section>
    </article>
  );
}
