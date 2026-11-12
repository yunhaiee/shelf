// Checkout on PayPal Orders v2. The seller's own PayPal account is the payee, so money goes straight
// to the shop; Shelf only creates the order, captures it after the buyer approves, and tracks status.
import {
  CheckoutPaymentIntent,
  ItemCategory,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type Order as PaypalOrder,
} from "@paypal/paypal-server-sdk";
import { appUrl, describePaypalError, paypal, paypalIssues, paypalStatusCode } from "./paypal";
import {
  createOrderRow,
  getOrderById,
  getOrderByPaypalId,
  getProductWithShop,
  setOrderPaypalId,
  updateOrderStatus,
} from "./repo";
import type { Order, Product, Shop } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QTY = 99;
const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);

// ---------- money: integer minor units, never float math ----------

function minorDigits(currency: string) {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

function toMinor(amount: number, currency: string) {
  return Math.round(amount * 10 ** minorDigits(currency));
}

/** Minor units -> PayPal value string ("56.00"). */
function formatMinor(minor: number, currency: string) {
  const d = minorDigits(currency);
  if (d === 0) return String(minor);
  const s = String(Math.abs(minor)).padStart(3, "0");
  return `${minor < 0 ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const clean = (s: string | null | undefined, n: number) => {
  const t = s?.trim();
  return t ? t.slice(0, n) : null;
};

// PayPal rejects item image URLs that don't match its pattern; only send ones that will pass.
const PAYPAL_IMAGE_RE = /^https:[/.\w\s-]*\.(?:jpg|gif|png|jpeg)$/i;

function approveLink(o: PaypalOrder) {
  return (o.links ?? []).find((l) => l.rel === "payer-action")?.href ?? (o.links ?? []).find((l) => l.rel === "approve")?.href;
}

// ---------- ship-to (agent-set gift address) ----------

/** A shipping address the agent supplies (e.g. a gift shipped to someone other than the buyer). */
export type ShipTo = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode?: string | null; // ISO 3166-1 alpha-2, default US
};

const SHIP_TO_FIELDS = [
  ["name", "ship_to_name"],
  ["line1", "ship_to_address_line1"],
  ["city", "ship_to_city"],
  ["state", "ship_to_state"],
  ["postalCode", "ship_to_postal_code"],
] as const;

/**
 * Validates raw ship-to fields. Returns null when none are given (buyer's PayPal address is used),
 * the normalized ShipTo when all required ones are given, or the missing input names when partial.
 */
export function parseShipTo(raw: Partial<Record<keyof ShipTo, string | null | undefined>>):
  | { shipTo: ShipTo; missing?: undefined }
  | { shipTo?: undefined; missing: string[] }
  | null {
  const v = (k: keyof ShipTo) => raw[k]?.trim() || "";
  const any = (["name", "line1", "line2", "city", "state", "postalCode", "countryCode"] as const).some((k) => v(k));
  if (!any) return null;
  const missing = SHIP_TO_FIELDS.filter(([k]) => !v(k)).map(([, name]) => name);
  if (missing.length) return { missing };
  const countryCode = (v("countryCode") || "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return { missing: ["ship_to_country (2-letter code like US)"] };
  return {
    shipTo: {
      name: v("name").slice(0, 300),
      line1: v("line1").slice(0, 300),
      line2: v("line2").slice(0, 300) || null,
      city: v("city").slice(0, 120),
      state: (countryCode === "US" ? v("state").toUpperCase() : v("state")).slice(0, 300),
      postalCode: v("postalCode").slice(0, 60),
      countryCode,
    },
  };
}

/** "Jiwoo Park, 123 Maple Ave, Portland, OR 97214" (country appended when not US). */
export function formatShipTo(s: ShipTo): string {
  const cc = (s.countryCode || "US").toUpperCase();
  return [s.name, s.line1, s.line2, s.city, `${s.state} ${s.postalCode}`, cc === "US" ? null : cc].filter(Boolean).join(", ");
}

// ---------- create ----------

export async function createCheckout(i: {
  productId: string;
  qty?: number;
  clientName?: string | null;
  query?: string | null;
  giftNote?: string | null;
  shipToName?: string | null;
  /** Agent-set address. When present PayPal ships to it (SET_PROVIDED_ADDRESS); otherwise the buyer's PayPal address. */
  shipTo?: ShipTo | null;
}): Promise<{ order: Order; approveUrl: string; product: Product; shop: Shop }> {
  const productId = String(i.productId ?? "").trim();
  if (!UUID_RE.test(productId)) throw new Error(`No product with id "${productId}". Use a product_id from search_products.`);

  const qty = i.qty == null ? 1 : Number(i.qty);
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantity must be a whole number of at least 1.");
  if (qty > MAX_QTY) throw new Error(`Quantity can be at most ${MAX_QTY} per checkout.`);

  const found = await getProductWithShop(productId);
  if (!found) throw new Error(`No product with id "${productId}". It may have been removed by the shop.`);
  const { product, shop } = found;

  if (shop.status !== "published") throw new Error(`${shop.name} isn't taking orders on Shelf right now.`);
  if (!shop.paypal_email) throw new Error(`${shop.name} hasn't connected a PayPal account yet, so it can't take payments.`);
  if (product.stock <= 0) throw new Error(`"${product.title}" from ${shop.name} is out of stock.`);
  if (product.stock < qty) throw new Error(`Only ${product.stock} of "${product.title}" left in stock.`);

  let shipTo: ShipTo | null = null;
  if (i.shipTo) {
    const parsed = parseShipTo(i.shipTo);
    if (parsed?.missing) throw new Error(`The shipping address is incomplete. Missing: ${parsed.missing.join(", ")}.`);
    shipTo = parsed?.shipTo ?? null;
  }

  const currency = (product.currency || "USD").toUpperCase();
  const unitMinor = toMinor(product.price, currency);
  if (!Number.isFinite(unitMinor) || unitMinor <= 0) throw new Error(`"${product.title}" doesn't have a valid price yet.`);
  const totalMinor = unitMinor * qty;
  const unit = formatMinor(unitMinor, currency);
  const total = formatMinor(totalMinor, currency);

  const order = await createOrderRow({
    product_id: product.id,
    shop_id: shop.id,
    qty,
    amount: Number(total),
    currency,
    client_name: clean(i.clientName, 120),
    query: clean(i.query, 500),
    gift_note: clean(i.giftNote, 500),
    // No address column: an agent-set ship-to is stored as one readable line ("Name, street, City, ST zip").
    ship_to_name: shipTo ? clip(formatShipTo(shipTo), 300) : clean(i.shipToName, 300),
  });

  const base = appUrl();
  const shopUrl = base.startsWith("https://") ? `${base}/s/${shop.slug}` : undefined;
  const description = product.description?.trim();

  let created: PaypalOrder;
  try {
    const res = await paypal().orders.createOrder({
      paypalRequestId: `create-${order.id}`,
      prefer: "return=representation",
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            referenceId: order.id,
            customId: order.id,
            invoiceId: `shelf-${order.id}`,
            description: clip(`${shop.name} via Shelf`, 127),
            payee: { emailAddress: shop.paypal_email },
            amount: {
              currencyCode: currency,
              value: total,
              breakdown: { itemTotal: { currencyCode: currency, value: total } },
            },
            items: [
              {
                name: clip(product.title, 127),
                quantity: String(qty),
                unitAmount: { currencyCode: currency, value: unit },
                category: ItemCategory.PhysicalGoods,
                sku: product.id,
                ...(description ? { description: clip(description, 127) } : {}),
                ...(shopUrl ? { url: shopUrl } : {}),
                ...(product.image_url && PAYPAL_IMAGE_RE.test(product.image_url) ? { imageUrl: product.image_url } : {}),
              },
            ],
            ...(shipTo
              ? {
                  shipping: {
                    name: { fullName: clip(shipTo.name, 300) },
                    address: {
                      addressLine1: clip(shipTo.line1, 300),
                      ...(shipTo.line2 ? { addressLine2: clip(shipTo.line2, 300) } : {}),
                      adminArea2: clip(shipTo.city, 120),
                      adminArea1: clip(shipTo.state, 300),
                      postalCode: clip(shipTo.postalCode, 60),
                      countryCode: shipTo.countryCode || "US",
                    },
                  },
                }
              : {}),
          },
        ],
        paymentSource: {
          paypal: {
            experienceContext: {
              brandName: clip(`Shelf · ${shop.name}`, 127),
              userAction: PaypalExperienceUserAction.PayNow,
              shippingPreference: shipTo
                ? PaypalWalletContextShippingPreference.SetProvidedAddress
                : PaypalWalletContextShippingPreference.GetFromFile,
              returnUrl: `${base}/api/paypal/return?order=${order.id}`,
              cancelUrl: `${base}/paid?order=${order.id}&cancelled=1`,
            },
          },
        },
      },
    });
    created = res.result;
  } catch (err) {
    await updateOrderStatus(order.id, "failed").catch(() => {});
    const issues = paypalIssues(err);
    if (shipTo && issues.some((x) => /ADDRESS|POSTAL|SHIPPING|COUNTRY|STATE|CITY/.test(x))) {
      throw new Error(
        `PayPal didn't accept the shipping address (${describePaypalError(err)}). Check the street, city, state and ZIP with the buyer, or leave the ship_to fields empty to use the buyer's PayPal address.`,
      );
    }
    if (issues.some((x) => x.startsWith("PAYEE_"))) {
      throw new Error(`${shop.name}'s PayPal account can't receive payments right now, so this checkout couldn't be created.`);
    }
    throw new Error(`PayPal couldn't create the checkout: ${describePaypalError(err)}`);
  }

  const approveUrl = created.id ? approveLink(created) : undefined;
  if (!created.id || !approveUrl) {
    await updateOrderStatus(order.id, "failed").catch(() => {});
    throw new Error("PayPal created the order but returned no approval link. Please try again.");
  }
  const saved = (await setOrderPaypalId(order.id, created.id)) ?? { ...order, paypal_order_id: created.id };
  return { order: saved, approveUrl, product, shop };
}

// ---------- capture / sync ----------

/** Applies a PayPal order snapshot to the local order row. Never downgrades paid/refunded (repo guarantees). */
async function applyPaypalOrder(local: Order, pp: PaypalOrder): Promise<Order> {
  const unit = pp.purchaseUnits?.[0];
  const capture = unit?.payments?.captures?.[0];
  const refunded = (unit?.payments?.refunds ?? []).some((r) => r.status === "COMPLETED");
  const payerEmail = pp.paymentSource?.paypal?.emailAddress ?? pp.payer?.emailAddress ?? null;
  const shipName = local.ship_to_name ? null : (unit?.shipping?.name?.fullName ?? null);
  const extra = { capture_id: capture?.id ?? null, payer_email: payerEmail, ship_to_name: shipName };

  let next: Order["status"] | null = null;
  if (refunded || capture?.status === "REFUNDED") next = "refunded";
  else if (capture?.status === "COMPLETED" || capture?.status === "PARTIALLY_REFUNDED") next = "paid";
  else if (capture?.status === "DECLINED" || capture?.status === "FAILED") next = "failed";
  else if (capture?.status === "PENDING" || pp.status === "APPROVED") next = "approved";
  else if (pp.status === "VOIDED") next = "cancelled";
  else if (pp.status === "COMPLETED") next = "paid";

  if (!next) return local;
  if (next === local.status && !extra.capture_id && !extra.payer_email) return local;
  return (await updateOrderStatus(local.id, next, extra)) ?? local;
}

const inflightCaptures = new Map<string, Promise<Order>>();

/** Captures an approved order. Idempotent: safe to call from the return route, the webhook, and check_order at once. */
export async function captureCheckout(paypalOrderId: string): Promise<Order> {
  const existing = inflightCaptures.get(paypalOrderId);
  if (existing) return existing;
  const p = doCapture(paypalOrderId).finally(() => inflightCaptures.delete(paypalOrderId));
  inflightCaptures.set(paypalOrderId, p);
  return p;
}

async function doCapture(paypalOrderId: string): Promise<Order> {
  const local = await getOrderByPaypalId(paypalOrderId);
  if (!local) throw new Error(`No Shelf order for PayPal order ${paypalOrderId}.`);
  if (local.status === "paid" || local.status === "refunded") return local;

  const { orders } = paypal();
  let pp: PaypalOrder;
  try {
    pp = (
      await orders.captureOrder({ id: paypalOrderId, paypalRequestId: `capture-${local.id}`, prefer: "return=representation" })
    ).result;
  } catch (err) {
    const issues = paypalIssues(err);
    if (issues.includes("ORDER_ALREADY_CAPTURED") || issues.includes("DUPLICATE_INVOICE_ID") || paypalStatusCode(err) === 422) {
      // Already captured elsewhere (or another business-rule rejection): trust PayPal's current view of the order.
      try {
        pp = (await orders.getOrder({ id: paypalOrderId })).result;
      } catch {
        throw new Error(`PayPal couldn't capture this payment: ${describePaypalError(err)}`);
      }
      if (pp.status !== "COMPLETED") {
        if (issues.includes("INSTRUMENT_DECLINED")) {
          throw new Error("The buyer's payment method was declined. Ask them to open the PayPal link again and pick another way to pay.");
        }
        if (issues.includes("ORDER_NOT_APPROVED") || issues.includes("PAYER_ACTION_REQUIRED")) {
          throw new Error("The buyer hasn't approved this payment in PayPal yet.");
        }
        throw new Error(`PayPal couldn't capture this payment: ${describePaypalError(err)}`);
      }
    } else {
      throw new Error(`PayPal couldn't capture this payment: ${describePaypalError(err)}`);
    }
  }
  return applyPaypalOrder(local, pp);
}

/** Order status for agents/dashboard. Accepts a Shelf order uuid or a PayPal order id. Refreshes from PayPal while unpaid. */
export async function getCheckoutStatus(orderId: string): Promise<{ order: Order; product: Product; shop: Shop } | null> {
  const id = String(orderId ?? "").trim();
  if (!id) return null;
  let order = UUID_RE.test(id) ? await getOrderById(id) : await getOrderByPaypalId(id);
  if (!order) return null;

  if (order.paypal_order_id && (order.status === "created" || order.status === "approved" || order.status === "cancelled")) {
    try {
      const pp = (await paypal().orders.getOrder({ id: order.paypal_order_id })).result;
      if (pp.status === "APPROVED") {
        // Buyer approved but never landed on our return URL (closed the tab): finish the payment now.
        order = await captureCheckout(order.paypal_order_id).catch(() => applyPaypalOrder(order!, pp));
      } else {
        order = await applyPaypalOrder(order, pp);
      }
    } catch (err) {
      console.warn(`[checkout] status refresh failed for ${order.id}: ${describePaypalError(err)}`);
    }
  }

  const found = await getProductWithShop(order.product_id);
  if (!found) return null;
  return { order, product: found.product, shop: found.shop };
}

/**
 * Full refund of the order's capture. Only a COMPLETED refund marks the order 'refunded'; a PENDING one
 * (e.g. the seller's balance is short) leaves it 'paid' until the PAYMENT.CAPTURE.REFUNDED webhook lands.
 * The capture belongs to the seller (payee routing), so PayPal may require partner permission from the seller;
 * that case surfaces as a readable error telling the seller to refund from their own PayPal account.
 */
export async function refundOrder(orderId: string): Promise<Order> {
  const status = await getCheckoutStatus(orderId);
  if (!status) throw new Error(`No order with id "${orderId}".`);
  const { order, shop } = status;
  if (order.status === "refunded") return order;
  if (order.status !== "paid" || !order.capture_id) {
    throw new Error(`Only paid orders can be refunded (this one is ${order.status}).`);
  }
  try {
    const res = await paypal().payments.refundCapturedPayment({
      captureId: order.capture_id,
      paypalRequestId: `refund-${order.id}`,
      prefer: "return=representation",
      body: { noteToPayer: clip(`Refund from ${shop.name} via Shelf`, 255) },
    });
    const st = res.result.status;
    if (st === "FAILED" || st === "CANCELLED") throw new Error(`PayPal reported the refund as ${st.toLowerCase()}.`);
    if (st !== "COMPLETED") return order; // PENDING: not refunded yet; the webhook finishes the transition.
  } catch (err) {
    const issues = paypalIssues(err);
    if (!issues.includes("CAPTURE_FULLY_REFUNDED")) {
      if (issues.some((x) => x === "PERMISSION_DENIED" || x === "NOT_AUTHORIZED")) {
        throw new Error(`PayPal didn't let Shelf refund on ${shop.name}'s behalf. The seller can refund it from their PayPal account.`);
      }
      throw new Error(err instanceof Error && !paypalStatusCode(err) ? err.message : `PayPal couldn't refund this order: ${describePaypalError(err)}`);
    }
  }
  return (await updateOrderStatus(order.id, "refunded")) ?? { ...order, status: "refunded" };
}
