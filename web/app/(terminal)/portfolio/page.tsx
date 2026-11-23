import PortfolioView from "@/components/PortfolioView";

export const metadata = { title: "Portfolio" };

export default function Page() {
  return (
    <>
      <div className="hero-s">
        <h1>Portfolio</h1>
        <p className="mut">Every token in your wallet, valued live and scanned by Vigil.</p>
      </div>
      <PortfolioView />
    </>
  );
}
