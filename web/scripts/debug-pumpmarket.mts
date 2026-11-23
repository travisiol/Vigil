// Compare le calcul tiré de la bonding curve avec DexScreener.
import { pumpMarket } from "@/lib/server/pump";
import { markets } from "@/lib/server/dex";
for (const m of process.argv.slice(2)) {
  const [ours, ds] = await Promise.all([pumpMarket(m), markets([m]).then((x) => x.get(m))]);
  console.log(m.slice(0, 6), "curve mcap", Math.round(ours?.mcap ?? 0), "price", ours?.priceUsd?.toExponential(3), "| DS mcap", Math.round(ds?.mcap ?? 0), "price", ds?.priceUsd?.toExponential?.(3));
}
