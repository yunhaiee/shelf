// Smoke test for the seller import pipeline (Claude extraction + enrichment + Channel3 comps). No DB writes.
//   npx tsx --env-file=.env scripts/test-import.mts                 # built-in messy text sample
//   npx tsx --env-file=.env scripts/test-import.mts --url <link>    # import a page
//   npx tsx --env-file=.env scripts/test-import.mts --text "..."    # your own text
import { importCatalog } from "../lib/importer.ts";

const SAMPLE = `hanul clay ✿ new drop!!
speckled mug 12oz $28 / celadon cup – 24 / oatmeal bowl (price dm me) / bud vase 18
all handmade in our little oakland studio 🌿 ships in 2 days`;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = flag("--url") ? { url: flag("--url") } : { text: flag("--text") ?? SAMPLE };

console.log("input:", JSON.stringify(input));
const t0 = Date.now();
try {
  const result = await importCatalog(input);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n${result.products.length} products in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const p of result.products)
    console.log(
      `- ${p.title}: ${p.price == null ? "no price" : `$${p.price}`}${p.ai_fields.includes("price") ? " (AI: Channel3 median)" : ""}` +
        ` | market ${p.market_low ?? "?"}-${p.market_high ?? "?"} (median ${p.market_median ?? "?"}) | ai_fields=${p.ai_fields.join(",")}`,
    );
} catch (err) {
  const e = err as Error & { status?: number };
  console.error(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e.name, e.status ?? "", e.message);
  process.exitCode = 1;
}
