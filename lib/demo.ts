// Public, read-only view of the demo shop's dashboard (/dash/demo), so judges can watch an order they place
// land without the seller's key. Strips everything that identifies the seller's PayPal account or the buyer.
import { publicShop } from "./auth";
import { getShopBySlug, listOrders, listRecentSearches, listShopSearches } from "./repo";
import type { Order, Shop } from "./types";

export const DEMO_SHOP_SLUG = process.env.DEMO_SHOP_SLUG?.trim() || "hanul-clay";

/** The published demo shop, or null if it isn't live (e.g. between demo re-recordings). */
export async function getDemoShop(): Promise<Shop | null> {
  const shop = await getShopBySlug(DEMO_SHOP_SLUG);
  return shop && shop.status === "published" ? shop : null;
}

type OrderRow = Order & { product_title: string };

function redactOrder(o: OrderRow): OrderRow {
  return { ...o, paypal_order_id: null, capture_id: null, payer_email: null, ship_to_name: null, gift_note: null };
}

export async function demoDashboard(shop: Shop) {
  const [orders, searches, network] = await Promise.all([
    listOrders(shop.id, 200),
    listShopSearches(shop.id, 200),
    listRecentSearches(100),
  ]);
  return {
    shop: { ...publicShop(shop), paypal_email: null },
    orders: orders.map(redactOrder),
    searches,
    network,
  };
}
