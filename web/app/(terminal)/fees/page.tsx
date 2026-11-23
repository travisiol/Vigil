import FeesView from "@/components/FeesView";
import { brand } from "@/brand.config";

export const metadata = { title: "Fees" };

export default function Page() {
  const f = brand.fees;
  const fee = f.tradeFeeBps / 100;
  const market = f.marketFeeBps / 100;
  const real = (f.tradeFeeBps * (100 - f.cashbackPct)) / 10000;
  const back = 100 - (f.split.find((s) => s.label === "Operations")?.pct ?? 0);
  return (
    <>
      <div className="hero-s">
        <h1>Half the fee. <span className="grad-text">{back}% comes back.</span></h1>
        <p className="mut">
          Most Solana terminals take about {market}% of every trade. Vigil takes {fee}%, and gives {back}% of it back to the people who use it: traders get cashback in SOL, holders get buybacks.
        </p>
      </div>

      <div className="compare">
        <div className="cmp">
          <span>Most terminals</span>
          <b className="mono">{market}%</b>
          <p>{(market / 100).toFixed(3)} SOL on a 1 SOL trade. Nothing comes back.</p>
          <i style={{ width: "100%" }} className="bar-m" />
        </div>
        <div className="cmp hi beam">
          <span>Vigil</span>
          <b className="mono grad-text">{fee}%</b>
          <p>{(fee / 100).toFixed(4)} SOL on a 1 SOL trade, shown before you sign.</p>
          <i style={{ width: `${(fee / market) * 100}%` }} className="bar-v" />
        </div>
        <div className="cmp">
          <span>Your real cost after cashback</span>
          <b className="mono" style={{ color: "var(--ok)" }}>{real}%</b>
          <p>{f.cashbackPct}% of your fee lands back in your wallet in SOL, every day.</p>
          <i style={{ width: `${(real / market) * 100}%` }} className="bar-ok" />
        </div>
      </div>

      <FeesView />
    </>
  );
}
