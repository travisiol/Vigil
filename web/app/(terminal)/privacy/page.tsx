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
        <p>Vigil reads the Solana token addresses shown on the pages where it runs and asks Vigil&apos;s server about them. A full read starts only on the token you click. That is all it sends. It never reads your wallet, your browsing history, your cookies or anything you type.</p>
      </section>

      <section>
        <h2>What the extension sends</h2>
        <ul>
          <li><b>Token addresses</b> visible on Axiom, GMGN, pump.fun, DexScreener, X, Padre, Photon and BullX, for a light check: is it a token, and does Vigil already know its verdict. No scan starts from this.</li>
          <li><b>The address of a token you click</b>, so the server reads its launch and returns a Clean, Watch or Bundled verdict. If you turn on automatic scan in the extension&apos;s window, every token on screen is read this way.</li>
          <li>Nothing else: no page content, no URLs of other sites, no identifiers, no account.</li>
        </ul>
      </section>

      <section>
        <h2>What the extension stores</h2>
        <ul>
          <li><b>Your settings</b> in your browser&apos;s storage: Vigil on or off for each site, automatic scan, Clean badges shown or hidden, and the Vigil server to ask. Chrome may sync these settings between your own browsers.</li>
          <li><b>The tokens you chose to scan</b> (up to 400 addresses) and where you put the panel, in your browser only, so they stay read when you come back.</li>
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
