import TokenView from "@/components/TokenView";

export const metadata = { title: "Token scan" };

export default async function Page({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <TokenView key={mint} mint={mint} />;
}
