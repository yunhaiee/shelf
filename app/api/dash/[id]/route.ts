// Seller dashboard feed (polled every 2s). Token via x-shop-token header or shelf_token_{id} cookie.
import { requireShop } from "@/lib/auth";
import { getShopById, listOrders, listRecentSearches, listShopSearches } from "@/lib/repo";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "cache-control": "no-store" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return Response.json({ error: "Shop not found." }, { status: 404, headers: noStore });

  try {
    // requireShop returns a ready-to-send Response when the token is missing/invalid.
    const auth: unknown = await requireShop(req, id);
    if (auth instanceof Response) return auth;

    const shop = await getShopById(id);
    if (!shop) return Response.json({ error: "Shop not found." }, { status: 404, headers: noStore });

    const [orders, searches, network] = await Promise.all([
      listOrders(id, 200),
      listShopSearches(id, 200),
      listRecentSearches(100),
    ]);
    return Response.json({ shop, orders, searches, network }, { headers: noStore });
  } catch (err) {
    console.error("[api/dash] failed", err);
    return Response.json({ error: "Couldn't load the dashboard. Try again in a moment." }, { status: 500, headers: noStore });
  }
}
