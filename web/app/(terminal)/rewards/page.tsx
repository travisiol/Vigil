import RewardsView from "@/components/RewardsView";
import { brand } from "@/brand.config";

export const metadata = { title: "Rewards" };

export default function Page() {
  return (
    <>
      <div className="hero-s">
        <h1>Your <span className="grad-text">cashback.</span></h1>
        <p className="mut">{brand.fees.cashbackPct}% of every fee you pay comes back to your wallet in SOL, every day. Nothing to claim.</p>
      </div>
      <RewardsView />
    </>
  );
}
