// PayPal webhooks: verify signature -> dedupe -> update the order. Handlers are idempotent and order status is
// also refreshed on demand (check_order), so a failed handler is logged and still answered with 200.
import { NextResponse, type NextRequest } from "next/server";
import { captureCheckout, getCheckoutStatus } from "@/lib/checkout";
import { describePaypalError, paypalStatusCode, verifyWebhookSignature } from "@/lib/paypal";
import { getOrderByCaptureId, getOrderById, getOrderByPaypalId, recordWebhookEvent, updateOrderStatus } from "@/lib/repo";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Link = { href?: string; rel?: string };
type WebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    links?: Link[];
    supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
    purchase_units?: { custom_id?: string; reference_id?: string }[];
  };
};

/** Finds the Shelf order a capture/refund resource belongs to, trying every reference PayPal gives us. */
async function findOrder(r: NonNullable<WebhookEvent["resource"]>, captureId?: string | null): Promise<Order | null> {
  if (r.custom_id && UUID_RE.test(r.custom_id)) {
    const o = await getOrderById(r.custom_id);
    if (o) return o;
  }
  const ppOrderId = r.supplementary_data?.related_ids?.order_id;
  if (ppOrderId) {
    const o = await getOrderByPaypalId(ppOrderId);
    if (o) return o;
  }
  if (captureId) return getOrderByCaptureId(captureId);
  return null;
}

/** Capture id a refund/reversal points at: related_ids, else the "up" link (/v2/payments/captures/{id}). */
function refundedCaptureId(r: NonNullable<WebhookEvent["resource"]>): string | null {
  const rel = r.supplementary_data?.related_ids?.capture_id;
  if (rel) return rel;
  const up = r.links?.find((l) => l.rel === "up" && l.href?.includes("/captures/"))?.href;
  return up?.match(/\/captures\/([^/?]+)/)?.[1] ?? null;
}

/**
 * Unverified event (dev without PAYPAL_WEBHOOK_ID): never trust the body. Use it only to find the Shelf order and
 * re-read that order from PayPal, so a forged "PAYMENT.CAPTURE.COMPLETED" can't mark anything paid.
 */
async function syncFromPaypal(evt: WebhookEvent) {
  const r = evt.resource;
  if (!r) return;
  const o =
    (r.id ? await getOrderByPaypalId(r.id) : null) ??
    (await findOrder(r, evt.event_type === "PAYMENT.CAPTURE.REFUNDED" ? refundedCaptureId(r) : (r.id ?? null)));
  if (o) await getCheckoutStatus(o.id);
}

async function handle(evt: WebhookEvent) {
  const r = evt.resource;
  if (!r) return;
  switch (evt.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      if (!r.id || !(await getOrderByPaypalId(r.id))) return; // not a Shelf order
      await captureCheckout(r.id);
      return;
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const o = await findOrder(r, r.id);
      if (o) await updateOrderStatus(o.id, "paid", { capture_id: r.id ?? null });
      return;
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      // REFUNDED's resource is the refund; REVERSED's is the capture itself.
      const captureId = evt.event_type === "PAYMENT.CAPTURE.REVERSED" ? (r.id ?? null) : refundedCaptureId(r);
      const o = await findOrder(r, captureId);
      if (o) await updateOrderStatus(o.id, "refunded");
      return;
    }
    case "PAYMENT.CAPTURE.DENIED": {
      const o = await findOrder(r, r.id);
      if (o) await updateOrderStatus(o.id, "failed", { capture_id: r.id ?? null });
      return;
    }
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let evt: WebhookEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!evt?.id || !evt.event_type) return NextResponse.json({ error: "not a PayPal event" }, { status: 400 });

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[paypal/webhook] PAYPAL_WEBHOOK_ID is not set; rejecting unverifiable event", evt.id);
      return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
    }
    console.warn("[paypal/webhook] PAYPAL_WEBHOOK_ID is not set; UNVERIFIED event (dev only), re-syncing from PayPal", evt.id);
  } else {
    let ok = false;
    try {
      ok = await verifyWebhookSignature(req.headers, raw, webhookId);
    } catch (err) {
      const code = paypalStatusCode(err);
      if (code != null && code >= 400 && code < 500) {
        // PayPal rejected the verification payload itself (malformed/forged headers): not a genuine delivery.
        console.warn("[paypal/webhook] verification rejected:", describePaypalError(err));
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
      }
      // PayPal unreachable: answer 5xx so PayPal redelivers later instead of us trusting an unverified body.
      console.error("[paypal/webhook] verification call failed:", describePaypalError(err));
      return NextResponse.json({ error: "verification unavailable" }, { status: 503 });
    }
    if (!ok) {
      console.warn("[paypal/webhook] signature verification failed for", evt.id);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  try {
    const first = await recordWebhookEvent({
      id: evt.id,
      event_type: evt.event_type,
      resource_id: evt.resource?.id ?? null,
      payload: evt,
    });
    if (!first) return NextResponse.json({ ok: true, duplicate: true });
  } catch (err) {
    console.error("[paypal/webhook] could not record event:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  }

  try {
    await (webhookId ? handle(evt) : syncFromPaypal(evt));
  } catch (err) {
    console.error(`[paypal/webhook] ${evt.event_type} ${evt.id} handler failed:`, err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}
