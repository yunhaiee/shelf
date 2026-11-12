// PayPal sends the buyer here after they approve: capture the payment, then show /paid.
import { NextResponse, type NextRequest } from "next/server";
import { captureCheckout } from "@/lib/checkout";
import { appUrl } from "@/lib/paypal";
import { getOrderById, getOrderByPaypalId } from "@/lib/repo";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shelfId = params.get("order") ?? "";
  const token = params.get("token") ?? ""; // PayPal order id, appended by PayPal
  const to = (q: string) => NextResponse.redirect(`${appUrl()}/paid?${q}`, 303);

  let id = shelfId;
  try {
    const order = UUID_RE.test(shelfId) ? await getOrderById(shelfId) : token ? await getOrderByPaypalId(token) : null;
    if (!order) return to(`order=${encodeURIComponent(shelfId)}`);
    id = order.id;
    // Capture what we created, not whatever token the URL claims.
    if (!order.paypal_order_id) return to(`order=${order.id}&error=1`);
    await captureCheckout(order.paypal_order_id);
    return to(`order=${order.id}`);
  } catch (err) {
    console.error(`[paypal/return] capture failed for ${shelfId || token}:`, err instanceof Error ? err.message : err);
    return to(`order=${encodeURIComponent(id)}&error=1`);
  }
}
