import Link from "next/link";
import { brand } from "@/brand.config";

export const metadata = { title: "Docs" };

const pc = (x: number) => `${Math.round(x * 100)}%`;

export default function Page() {
  const t = brand.scan;
  const fee = brand.fees.tradeFeeBps / 100;
  return (
    <article className="doc">
      <div className="hero-s">
        <h1>How Vigil <span className="grad-text">watches.</span></h1>
        <p className="mut">What Vigil reads, how a verdict is decided and graded, what a trade costs and why your keys never leave your wallet.</p>
      </div>

      <section>
        <h2>Three speeds</h2>
        <p>Vigil watches every pump.fun launch from its first second, whether anyone looks at it or not, and judges it in three steps. Each step replaces the one before.</p>
        <table>
          <thead><tr><th>When</th><th>What Vigil reads</th></tr></thead>
          <tbody>
            <tr><td><b>First look</b><br /><span className="mut">~8 seconds after launch</span></td><td>How much of the supply was bought in the first seconds, read straight from the bonding curve, and everything Vigil remembers about the dev. No extra request: this is why every launch gets a verdict in seconds.</td></tr>
            <tr><td><b>Quick scan</b><br /><span className="mut">a few seconds</span></td><td>Holders, the dev&apos;s wallet, mint and freeze authority, liquidity, bundler and insider labels.</td></tr>
            <tr><td><b>Full scan</b><br /><span className="mut">when you open a token, and for every token in Final stretch</span></td><td>Every buy of the first 10 seconds, who funded each of those wallets (two hops back), and which holders are secretly the same person.</td></tr>
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
            <tr><td><b>Dev memory</b></td><td>Vigil records every launch it sees. A wallet that launched 3 tokens in 24 hours is a <i>serial dev</i>. A wallet that funds several dev wallets runs a <i>dev farm</i>. A dev wallet created less than an hour before launch is flagged too.</td></tr>
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
        <h2>Track record</h2>
        <p>Vigil grades itself in public. The first verdict shown on each launch is frozen, then graded 15 minutes later from what the bonding curve became: migrated, still alive, faded, crashed or never took off. Grades are never edited. See them on the <Link href="/track" style={{ textDecoration: "underline" }}>Track record</Link> page.</p>
      </section>

      <section>
        <h2>Verify everything</h2>
        <p>Nothing Vigil claims needs to be taken on trust. The <Link href="/verify" style={{ textDecoration: "underline" }}>Verify</Link> page recomputes every number from public transactions:</p>
        <ul>
          <li><b>Fees</b>: each Vigil trade pays a separate {fee}% SOL transfer, shown before you sign and counted on the Verify page.</li>
          <li><b>Cashback</b>: paid daily from the cashback wallet; every payout carries the memo <code>vigil-cashback</code>.</li>
          <li><b>Buybacks</b>: {brand.fees.split.find((x) => /buyback/i.test(x.label))?.pct ?? 50}% of fees buy $VIGIL on the open market, memo <code>vigil-buyback</code>; half of what is bought is burned, memo <code>vigil-burn</code>. Until $VIGIL launches, the buyback share is set aside and spent on the first buyback.</li>
          <li><b>Verdicts</b>: every first verdict is frozen and graded 15 minutes later; the raw grades can be downloaded.</li>
        </ul>
      </section>

      <section>
        <h2>Fees</h2>
        <p><b>{fee}% per trade</b>, half of the ~1% most Solana terminals charge, in SOL, inside the transaction you sign. {brand.fees.cashbackPct}% of it comes back to you as daily SOL cashback, so your real cost is {(brand.fees.tradeFeeBps * (100 - brand.fees.cashbackPct)) / 10000}%. On a buy it comes out of the SOL you spend; on a sell it is {fee}% of the minimum SOL you are guaranteed to receive. If the trade fails, the fee fails with it. Where it goes is public on the <Link href="/fees" style={{ textDecoration: "underline" }}>Fees page</Link>.</p>
      </section>

      <section>
        <h2>Security</h2>
        <ul>
          <li><b>Non-custodial.</b> Vigil never holds your funds or your keys. Every trade is a transaction you read and sign in your own wallet.</li>
          <li><b>Best route.</b> Trades are routed by Jupiter across pump.fun, PumpSwap, Raydium, Meteora and more.</li>
          <li><b>Checked before you sign.</b> Each trade is simulated first, so a trade that would fail is stopped before it reaches your wallet.</li>
        </ul>
      </section>

      <section>
        <h2>Limits today</h2>
        <ul>
          <li>Tokens with a very long history can&apos;t be traced back to their launch live yet: the 10-second signal then shows &quot;not measured&quot;.</li>
          <li>The full scan runs when you open a token and on every token in Final stretch. Brand-new launches get the first look and the quick scan first.</li>
          <li>Dev memory starts the day Vigil started watching: a dev&apos;s older launches only count once Vigil has seen them.</li>
        </ul>
      </section>
    </article>
  );
}
