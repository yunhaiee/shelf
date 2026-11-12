// GET /api/dash/demo/insights -> demand insights for the demo shop. Public, so results are cached for a few
// minutes and concurrent requests share one model call.
import { demandInsights, type Insight } from "@/lib/ai";
import { handle, jsonError } from "@/lib/auth";
import { getDemoShop } from "@/lib/demo";
import { listProducts, listRecentSearches } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TTL_MS = 5 * 60_000;
const g = globalThis as unknown as {
  __shelfDemoInsights?: { shopId: string; at: number; insights: Insight[] };
  __shelfDemoInsightsInflight?: Promise<Insight[]> | null;
};

export async function GET() {
  return handle(async () => {
    const shop = await getDemoShop();
    if (!shop) return jsonError(404, "The demo shop isn't published right now.");

    const hit = g.__shelfDemoInsights;
    if (hit && hit.shopId === shop.id && Date.now() - hit.at < TTL_MS) return Response.json({ insights: hit.insights });

    g.__shelfDemoInsightsInflight ??= (async () => {
      const [products, searches] = await Promise.all([listProducts(shop.id), listRecentSearches(300)]);
      const insights = await demandInsights(shop, products, searches);
      g.__shelfDemoInsights = { shopId: shop.id, at: Date.now(), insights };
      return insights;
    })().finally(() => (g.__shelfDemoInsightsInflight = null));

    return Response.json({ insights: await g.__shelfDemoInsightsInflight });
  });
}
