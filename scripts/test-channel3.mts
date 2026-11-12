// Run: npx tsx --env-file=.env scripts/test-channel3.mts
import { searchMarket, priceComps } from "../lib/channel3.ts";

const items = await searchMarket("handmade speckled ceramic mug", { maxPrice: 40, limit: 5 });
console.table(items.map(({ title, merchant, price }) => ({ title: title.slice(0, 50), merchant, price })));

const comps = await priceComps("speckled stoneware mug 12oz");
console.log("price comps:", comps && { n: comps.n, low: comps.low, median: comps.median, high: comps.high });
