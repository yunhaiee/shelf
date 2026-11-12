"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchLog, Shop } from "@/lib/types";
import { api, ApiError, errorMessage, saveToken } from "@/components/api";
import { money, relativeTime } from "@/components/format";
import { OrdersGrid, type OrderRow } from "@/components/grid/OrdersGrid";
import { DemandGrid, type DemandRow } from "@/components/grid/DemandGrid";

type DashData = { shop: Shop; orders: OrderRow[]; searches: SearchLog[]; network: SearchLog[] };
type Insight = { headline: string; detail: string; query_examples: string[]; count: number };
type Event = { id: string; text: string; at: number; tone: "paid" | "new" | "other" };

const POLL_MS = 2000;
// On the first load, orders paid (or started) this recently still flash and get announced, so a dashboard
// opened right after a sale shows the moment instead of a static row.
const FRESH_MS = 3 * 60_000;

function isFresh(at: string | null, now: number) {
  if (!at) return false;
  const age = now - Date.parse(at);
  return age > -60_000 && age < FRESH_MS; // tolerate a little client/server clock skew
}

/**
 * Seller dashboard. `demo` renders the public read-only view of the demo shop (/dash/demo): same grids and
 * insights, no editing, no seller key, seller PayPal email withheld by the server.
 */
export function Dashboard(props: { shopId: string; demo?: false } | { demo: true; shopId?: undefined }) {
  const demo = props.demo === true;
  const shopId = props.shopId ?? null;
  const feedUrl = demo ? "/api/dash/demo" : `/api/dash/${shopId}`;
  const [data, setData] = useState<DashData | null>(null);
  const [authError, setAuthError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [event, setEvent] = useState<Event | null>(null);
  const [keyInput, setKeyInput] = useState("");

  const prevOrders = useRef<Map<string, string> | null>(null);
  const lastJson = useRef("");
  const inFlight = useRef(false);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current || stopped.current) return;
    inFlight.current = true;
    try {
      const d = await api<DashData>(feedUrl, shopId ? { shopId } : {});
      setAuthError(false);
      setLoadError(null);
      setLastOk(Date.now());

      const json = JSON.stringify(d);
      if (json === lastJson.current) return;
      lastJson.current = json;

      // Diff orders against the previous poll: new or changed rows flash; a fresh payment gets announced.
      const prev = prevOrders.current;
      const changed: string[] = [];
      let ev: Event | null = null;
      const t = Date.now();
      for (const o of d.orders) {
        const sig = `${o.status}|${o.amount}|${o.qty}`;
        const was = prev?.get(o.id);
        if (prev) {
          if (was === sig) continue;
        } else {
          const fresh =
            o.status === "paid"
              ? isFresh(o.paid_at, t)
              : (o.status === "created" || o.status === "approved") && isFresh(o.created_at, t);
          if (!fresh) continue;
        }
        changed.push(o.id);
        const amount = money(o.amount, o.currency, { cents: true });
        const who = o.client_name || "an AI agent";
        if (o.status === "paid" && !was?.startsWith("paid")) {
          ev ??= { id: o.id, at: Date.now(), tone: "paid", text: `Paid ${amount} for ${o.product_title}, via ${who}.` };
        } else if (!was) {
          ev ??= {
            id: o.id,
            at: Date.now(),
            tone: "new",
            text: `New order from ${who}: ${o.product_title}, ${amount}. Waiting for the buyer to approve in PayPal.`,
          };
        } else if (o.status === "refunded") {
          ev ??= { id: o.id, at: Date.now(), tone: "other", text: `Refunded ${amount} for ${o.product_title}.` };
        }
      }
      prevOrders.current = new Map(d.orders.map((o) => [o.id, `${o.status}|${o.amount}|${o.qty}`]));
      if (changed.length) setFlashIds(changed);
      if (ev) setEvent(ev);
      setData(d);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAuthError(true);
        stopped.current = true;
      } else if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        stopped.current = true;
      } else {
        setLoadError(errorMessage(err, "Lost connection. Retrying…"));
      }
    } finally {
      inFlight.current = false;
    }
  }, [feedUrl, shopId]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function submitKey(e: React.FormEvent) {
    e.preventDefault();
    const k = keyInput.trim();
    if (!k || !shopId) return;
    saveToken(shopId, k);
    stopped.current = false;
    setAuthError(false);
    load();
  }

  const demandRows = useMemo<DemandRow[]>(() => {
    if (!data) return [];
    const mine = new Set(data.searches.map((s) => s.id));
    return data.network.map((s) => ({ ...s, matched: mine.has(s.id) }));
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    const paid = data.orders.filter((o) => o.status === "paid");
    const currency = data.orders[0]?.currency ?? "USD";
    return {
      revenue: money(
        paid.reduce((n, o) => n + o.amount, 0),
        currency,
        { cents: paid.some((o) => !Number.isInteger(o.amount)) },
      ),
      paidCount: paid.length,
      orderCount: data.orders.length,
      found: data.searches.length,
      unmet: data.network.filter((s) => s.shelf_hit_count === 0).length,
    };
  }, [data]);

  // ---------- states ----------

  if (notFound) {
    return (
      <section className="wrap py-20">
        <h1 className="display text-[48px]">No shop here</h1>
        <p className="mt-4 text-ink/80">
          {demo ? "The demo shop isn\u2019t published right now. " : "This dashboard link doesn\u2019t match a shop. "}
          <Link href="/sell" className="link">
            Open a shop
          </Link>
          .
        </p>
      </section>
    );
  }

  if (authError) {
    return (
      <section className="wrap py-16 sm:py-20">
        <div className="max-w-[560px]">
          <h1 className="display text-[44px] sm:text-[56px]">This dashboard is private</h1>
          <p className="mt-4 text-ink/80">
            Open it in the browser you published from, or paste your shop key. The key was shown when the shop was
            created.
          </p>
          <form onSubmit={submitKey} className="mt-8">
            <label htmlFor="shop-key" className="label">
              Shop key
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="shop-key"
                className="field mono flex-1 text-[14px]"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <button type="submit" className="btn">
                Open dashboard
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (!data || !stats) {
    return (
      <section className="wrap py-20">
        <p className="text-muted" aria-live="polite">
          {loadError ?? "Loading your dashboard…"}
        </p>
      </section>
    );
  }

  const { shop } = data;
  const live = shop.status === "published";
  const updatedAgo = lastOk ? Math.max(0, Math.round((now - lastOk) / 1000)) : null;
  const showEvent = event && now - event.at < 60_000;

  return (
    <div className="pb-8">
      {/* Header */}
      <section className="wrap-wide pt-10 sm:pt-14">
        <p className="eyebrow">{demo ? "Seller dashboard \u00b7 read-only demo" : "Seller dashboard"}</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h1 className="display text-[48px] leading-[1.02] sm:text-[72px]">{shop.name}</h1>
          <nav className="flex items-center gap-6 pb-2 text-[14px]" aria-label="Shop">
            {!demo && (
              <Link href={`/sell?shop=${shop.id}`} className="link">
                Edit catalog
              </Link>
            )}
            {live && (
              <Link href={`/s/${shop.slug}`} className="link">
                Public page
              </Link>
            )}
          </nav>
        </div>

        {demo && (
          <p className="mt-4 max-w-[64ch] text-[15px] text-ink/80">
            {shop.name}&rsquo;s seller view, open to everyone. Buy something from {shop.name} in Claude and the order
            appears here within seconds, then turns paid when PayPal confirms it.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-2 text-[14px]">
          {live ? (
            <p className="flex items-center gap-2 text-ok">
              <span className="dot dot-live" aria-hidden />
              <span>
                Live. Assistants can find and buy from you
                {shop.published_at ? <span className="text-muted"> since {relativeTime(shop.published_at, now)}</span> : null}.
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-warn">
              <span className="dot" aria-hidden />
              <span>
                Draft. Assistants can&rsquo;t see this shop yet.{" "}
                <Link href={`/sell?shop=${shop.id}`} className="link text-warn">
                  Publish it
                </Link>
              </span>
            </p>
          )}
          <p className="mono text-[12px] text-muted" aria-live="off">
            {loadError ? (
              <span className="text-accent">{loadError}</span>
            ) : updatedAgo == null ? (
              ""
            ) : updatedAgo < 3 ? (
              "Updated just now"
            ) : (
              `Updated ${updatedAgo}s ago`
            )}
          </p>
        </div>

        <div aria-live="polite" className="min-h-0">
          {showEvent && (
            <p
              key={event.id + event.at}
              className={`rise mt-6 border-l-2 py-2 pl-4 text-[16px] ${
                event.tone === "paid" ? "border-ok bg-accent-soft/40" : "border-accent"
              }`}
            >
              {event.text}
            </p>
          )}
        </div>
      </section>

      {/* Numbers */}
      <section className="wrap-wide mt-10">
        <dl className="grid grid-cols-2 border-y border-line md:grid-cols-4">
          <Stat i={0} label="Paid revenue" value={stats.revenue} />
          <Stat i={1} label="Orders" value={`${stats.paidCount}`} sub={`${stats.orderCount} started`} />
          <Stat i={2} label="Times assistants recommended you" value={`${stats.found}`} sub="as the top Shelf result" />
          <Stat i={3} label="Unmet searches on Shelf" value={`${stats.unmet}`} sub={`of last ${data.network.length}`} />
        </dl>
      </section>

      {/* Orders */}
      <section className="wrap-wide mt-14">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-[32px] sm:text-[40px]">Orders</h2>
          <p className="text-[13px] text-muted">
            Placed by assistants, paid through PayPal to{" "}
            {demo ? "the seller\u2019s own account" : (shop.paypal_email ?? "your account")}.
          </p>
        </div>
        <OrdersGrid rows={data.orders} flashIds={flashIds} />
      </section>

      {/* Demand + insights */}
      <section className="wrap-wide mt-16 grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="min-w-0 lg:col-span-8">
          <div className="mb-4">
            <p className="eyebrow mb-2">Includes sample search history</p>
            <h2 className="display text-[32px] sm:text-[40px]">Agent demand</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] text-muted">
              What shoppers recently asked assistants across Shelf. &ldquo;Nothing on Shelf&rdquo; is open demand no shop
              is meeting yet.
            </p>
          </div>
          <DemandGrid rows={demandRows} now={now} />
        </div>
        <div className="lg:col-span-4">
          <Insights url={demo ? "/api/dash/demo/insights" : `/api/shops/${shop.id}/insights`} shopId={shopId} />
        </div>
      </section>
    </div>
  );
}

// Hairline-separated figures: 2×2 on phones, one row from md up.
const STAT_POS = [
  "pr-4 md:pr-6",
  "border-l pl-4 md:px-6",
  "border-t pr-4 md:border-l md:border-t-0 md:px-6",
  "border-l border-t pl-4 md:border-t-0 md:px-6",
];

function Stat({ i, label, value, sub }: { i: number; label: string; value: string; sub?: string }) {
  return (
    <div className={`border-line py-6 ${STAT_POS[i]}`}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-2">
        <span className="display text-[40px] leading-none tabular-nums sm:text-[48px]">{value}</span>
        {sub && <span className="text-[12px] text-muted">{sub}</span>}
      </dd>
    </div>
  );
}

function Insights({ url, shopId }: { url: string; shopId: string | null }) {
  const [items, setItems] = useState<Insight[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ insights: Insight[] }>(url, shopId ? { shopId } : {});
      setItems(Array.isArray(r.insights) ? r.insights : []);
    } catch (err) {
      setError(errorMessage(err, "Couldn't analyze demand right now."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="display text-[32px] sm:text-[40px]">Insights</h2>
      <p className="mt-1 text-[13px] text-muted">
        Shelf&rsquo;s AI reads recent agent searches and tells you what shoppers want that you could make.
      </p>
      <button type="button" className="btn btn-line mt-5" onClick={analyze} disabled={loading}>
        {loading ? "Reading recent searches…" : items ? "Analyze again" : "Analyze demand"}
      </button>

      {error && (
        <p role="alert" className="mt-4 text-[14px] text-accent">
          {error}
        </p>
      )}

      {items && items.length === 0 && !loading && (
        <p className="mt-6 text-[14px] text-ink/80">No clear gaps yet. Check back after more agent searches.</p>
      )}

      {items && items.length > 0 && (
        <ol className="mt-6 border-b border-line" aria-live="polite">
          {items.map((it, i) => (
            <li key={`${it.headline}-${i}`} className="rise border-t border-line py-5" style={{ animationDelay: `${i * 90}ms` }}>
              <p className="mono text-[12px] text-accent">{it.count}× asked</p>
              <p className="display mt-1 text-[24px] leading-[1.15]">{it.headline}</p>
              {it.detail && <p className="mt-2 text-[14px] text-ink/80">{it.detail}</p>}
              {it.query_examples?.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {it.query_examples.slice(0, 4).map((q) => (
                    <li key={q} className="mono text-[12px] text-muted">
                      &ldquo;{q}&rdquo;
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
