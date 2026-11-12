// Channel3 = the "big catalog" side of Shelf search, plus market price comps
// for sellers. Server-only: the API key never reaches the browser.
import { Channel3, type Channel3Api } from "@channel3/sdk";

type Product = Channel3Api.Product;

let client: Channel3 | null = null;

function getClient(): Channel3 {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new Error("CHANNEL3_API_KEY is not set");
  client ??= new Channel3({ apiKey });
  return client;
}

/** A Channel3 product flattened to what Shelf search and the dashboard need. */
export type MarketItem = {
  source: "channel3";
  id: string;
  title: string;
  brand: string | null;
  merchant: string | null; // retailer domain, e.g. "target.com"
  price: number | null;
  currency: string;
  imageUrl: string | null;
  buyUrl: string | null; // leaves the chat; Shelf shops check out in-chat with PayPal
};

function cheapestOffer(p: Product) {
  return (p.offers ?? [])
    .filter((o) => o.price?.price != null)
    .sort((a, b) => a.price.price - b.price.price)[0];
}

export function toMarketItem(p: Product): MarketItem {
  const offer = cheapestOffer(p);
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    source: "channel3",
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    merchant: offer?.domain ?? null,
    price: offer?.price.price ?? null,
    currency: offer?.price.currency ?? "USD",
    imageUrl: image?.cleaned_url ?? image?.url ?? null,
    buyUrl: offer?.url ?? null,
  };
}

/** Search the wider market. `maxPrice` maps to Channel3's structured price filter. */
export async function searchMarket(
  query: string,
  opts: { maxPrice?: number; limit?: number; agentic?: boolean } = {},
): Promise<MarketItem[]> {
  const page = await getClient().products.search({
    query,
    limit: opts.limit ?? 8,
    ...(opts.maxPrice != null && { filters: { price: { max_price: opts.maxPrice } } }),
    ...(opts.agentic && { config: { mode: "agentic" } }),
  });
  return page.data.map(toMarketItem);
}

/** Market price range for a seller's product, used to suggest a price in the catalog editor. */
export async function priceComps(title: string) {
  const items = await searchMarket(title, { limit: 20 });
  const prices = items.map((i) => i.price).filter((p): p is number => p != null).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
  return { n: prices.length, low: at(0.25), median: at(0.5), high: at(0.75), examples: items.slice(0, 3) };
}
