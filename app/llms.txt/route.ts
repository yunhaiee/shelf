// /llms.txt — plain-text guide for AI crawlers and agents: what Shelf is, how to connect, what's for sale.
import { listProducts, listPublishedShops } from "@/lib/repo";
import { appUrlFromRequest } from "@/components/app-url";

export const dynamic = "force-dynamic";

const oneLine = (s: string | null | undefined, max = 160) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const price = (n: number, currency: string) => `${n.toFixed(2)} ${currency || "USD"}`;

export async function GET(req: Request) {
  const base = appUrlFromRequest(req);
  const lines: string[] = [
    "# Shelf",
    "",
    "> Shelf makes independent small shops searchable and buyable inside AI assistants. Checkout runs through PayPal: the buyer approves every payment, and the money goes straight to the seller's own PayPal account.",
    "",
    "## Connect",
    "",
    `- MCP endpoint (streamable HTTP, no auth): ${base}/api/mcp`,
    "- Tools: search_products (Shelf shops first, buyable in chat; wider market results via Channel3 as links), get_product, create_checkout (returns a PayPal approval link), check_order",
    "- Rules for agents: always show the buyer the PayPal approval link; never say an order is paid until check_order reports it paid.",
    `- Claude: Settings → Connectors → Add custom connector → ${base}/api/mcp`,
    "",
  ];

  try {
    const shops = await listPublishedShops();
    const withProducts = await Promise.all(shops.map(async (s) => ({ shop: s, products: await listProducts(s.id) })));

    lines.push("## Shops", "");
    if (withProducts.length === 0) lines.push("No shops are published yet.", "");

    for (const { shop, products } of withProducts) {
      lines.push(`### ${shop.name}${shop.location ? ` (${shop.location})` : ""}`, "");
      const about = oneLine(shop.tagline || shop.about, 240);
      if (about) lines.push(about, "");
      lines.push(`Page: ${base}/s/${shop.slug}`, "");
      for (const p of products) {
        if (p.stock <= 0) continue;
        const desc = oneLine(p.description, 140);
        lines.push(`- ${p.title}: ${price(p.price, p.currency)}${desc ? `. ${desc}` : ""} (product_id: ${p.id})`);
      }
      lines.push("");
    }
  } catch (err) {
    console.error("[llms.txt] could not list shops", err);
    lines.push("## Shops", "", "The shop list is temporarily unavailable. Use search_products over MCP.", "");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
