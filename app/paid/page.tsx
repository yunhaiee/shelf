// Where the buyer lands after PayPal (return route redirect, or cancel_url). Calm, text-only confirmation.
import type { Metadata } from "next";
import { getCheckoutStatus } from "@/lib/checkout";
import { isDemoShop, updateOrderStatus } from "@/lib/repo";
import type { Order, Product, Shop } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shelf · Payment", robots: { index: false } };

type Search = { order?: string; cancelled?: string; error?: string };

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function when(ts: string | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }) + " PT";
}

type View = { eyebrow: string; title: string; body: string };

function viewFor(order: Order | null, shop: Shop | null, flags: { cancelled: boolean; error: boolean }): View {
  if (!order || !shop) {
    return {
      eyebrow: "Order",
      title: "We couldn't find that order.",
      body: "If you were checking out, go back to your assistant and ask it to check the order or start a new checkout.",
    };
  }
  switch (order.status) {
    case "paid":
      return {
        eyebrow: "Paid",
        title: "Payment approved.",
        body: `You can go back to your assistant. ${shop.name} has your order and ships to the address on your PayPal account.`,
      };
    case "approved":
      return {
        eyebrow: "Approved",
        title: "Payment approved.",
        body: "PayPal is finishing the payment. You can go back to your assistant; it will confirm once the payment clears.",
      };
    case "refunded":
      return {
        eyebrow: "Refunded",
        title: "This order was refunded.",
        body: "The full amount went back to your PayPal account.",
      };
    case "cancelled":
      return {
        eyebrow: "Cancelled",
        title: "Checkout cancelled.",
        body: "Nothing was charged. Go back to your assistant if you'd like to try again.",
      };
    case "failed":
      return {
        eyebrow: "Not completed",
        title: "PayPal couldn't complete this payment.",
        body: "Nothing was charged. Go back to your assistant and ask it to start a new checkout.",
      };
    default:
      if (flags.cancelled) {
        return { eyebrow: "Cancelled", title: "Checkout cancelled.", body: "Nothing was charged. Go back to your assistant if you'd like to try again." };
      }
      if (flags.error) {
        return {
          eyebrow: "Not completed",
          title: "PayPal couldn't complete this payment.",
          body: "Nothing was charged. Open the PayPal link from your assistant again, or ask it to start a new checkout.",
        };
      }
      return {
        eyebrow: "Waiting",
        title: "Waiting for your approval in PayPal.",
        body: "Open the PayPal link your assistant gave you and approve the payment. This page won't charge you.",
      };
  }
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-[var(--line)] py-3">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">{label}</dt>
      <dd className={`text-right text-[var(--ink)] ${mono ? "font-mono text-[13px] break-all" : "text-[15px]"}`}>{children}</dd>
    </div>
  );
}

export default async function PaidPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const flags = { cancelled: sp.cancelled === "1", error: sp.error === "1" };

  let data: { order: Order; product: Product; shop: Shop } | null = null;
  try {
    data = sp.order ? await getCheckoutStatus(sp.order) : null;
    // cancel_url: only an order nobody has paid for yet can become 'cancelled'.
    if (data && flags.cancelled && data.order.status === "created") {
      const o = await updateOrderStatus(data.order.id, "cancelled");
      if (o) data = { ...data, order: o };
    }
  } catch (err) {
    console.error("[paid] could not load order:", err instanceof Error ? err.message : err);
  }

  let view = viewFor(data?.order ?? null, data?.shop ?? null, flags);
  // Orders from the /try judge demo: the "assistant" is the Shelf demo tab the judge came from.
  if (data && (await isDemoShop(data.shop.id).catch(() => false))) {
    view = { ...view, body: view.body.replace(/your assistant/g, "the Shelf demo tab") };
  }
  const showSummary = data && data.order.status !== "cancelled";

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto max-w-[560px] px-6 py-20 sm:py-28">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Shelf · {view.eyebrow}</p>
        <h1 className="mt-4 font-serif text-[40px] leading-[1.1] tracking-[-0.01em] sm:text-[48px]">{view.title}</h1>
        <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-[var(--muted)]">{view.body}</p>

        {data && showSummary && (
          <dl className="mt-12 border-b border-[var(--line)]">
            <Row label="Item">
              {data.product.title}
              {data.order.qty > 1 ? <span className="text-[var(--muted)]"> × {data.order.qty}</span> : null}
            </Row>
            <Row label="Shop">{data.shop.name}</Row>
            <Row label="Total">{money(data.order.amount, data.order.currency)}</Row>
            {data.order.paid_at && <Row label="Paid">{when(data.order.paid_at)}</Row>}
            {data.order.gift_note && <Row label="Gift note">{data.order.gift_note}</Row>}
            <Row label="Order" mono>
              {data.order.id}
            </Row>
          </dl>
        )}

        <p className="mt-12 text-[13px] leading-relaxed text-[var(--muted)]">
          Payments on Shelf go through PayPal, straight to {data?.shop.name ?? "the shop"}. Shelf never sees your card
          or bank details.
        </p>
      </div>
    </main>
  );
}
