// GET /api/try/status?session=<uuid>[&full=1] -> { shop, orders, products? } for this judge's demo shop (polled every 2s by /try).
// The session id is the only key; buyer/PayPal identifiers are stripped.
import type { NextRequest } from "next/server";
import { handle, jsonError, publicShop } from "@/lib/auth";
import { getDemoSessionShop, listOrders, listProducts } from "@/lib/repo";
import { parseSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = parseSession(req.nextUrl.searchParams.get("session"));
    if (!session) return jsonError(400, "Missing or invalid demo session.");
    const shop = await getDemoSessionShop(session);
    if (!shop) return Response.json({ shop: null, orders: [] }, { headers: { "cache-control": "no-store" } });
    const orders = (await listOrders(shop.id, 50)).map((o) => ({
      ...o,
      paypal_order_id: null,
      capture_id: null,
      payer_email: null,
    }));
    // ?full=1 (page reload) also returns the catalog so the page can redraw step 01.
    const products = req.nextUrl.searchParams.get("full") === "1" ? await listProducts(shop.id) : undefined;
    return Response.json(
      { shop: { ...publicShop(shop), paypal_email: null }, orders, products },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
