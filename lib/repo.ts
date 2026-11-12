// Data access for every module. Converts pg numeric strings -> numbers.
// Rule: no other file writes SQL against shops/products/orders/searches; add a function here instead.
import { query, queryOne } from "./db";
import type { DraftProduct, Order, OrderStatus, Product, SearchLog, Shop } from "./types";

const num = (v: unknown) => (v == null ? null : Number(v));

const SHOP_COLS = `id, slug, name, tagline, about, location, paypal_email, source_url, status, created_at, published_at`;

function toProduct(r: Record<string, unknown>): Product {
  return {
    ...(r as unknown as Product),
    price: Number(r.price),
    market_low: num(r.market_low),
    market_median: num(r.market_median),
    market_high: num(r.market_high),
  };
}

function toOrder(r: Record<string, unknown>): Order {
  return { ...(r as unknown as Order), amount: Number(r.amount) };
}

function toSearch(r: Record<string, unknown>): SearchLog {
  return { ...(r as unknown as SearchLog), max_price: num(r.max_price) };
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 48) || "shop";
}

// ---------- shops ----------

export async function getShopBySlug(slug: string) {
  return queryOne<Shop>(`select ${SHOP_COLS} from shops where slug = $1`, [slug]);
}

/** A real (non-/try) shop by slug. Use this for the fixed demo slug so a judge's copy can never stand in for it. */
export async function getRealShopBySlug(slug: string) {
  return queryOne<Shop>(`select ${SHOP_COLS} from shops where slug = $1 and demo_session is null`, [slug]);
}

export async function getShopById(id: string) {
  return queryOne<Shop>(`select ${SHOP_COLS} from shops where id = $1`, [id]);
}

export async function listPublishedShops() {
  // Shops made by judges on /try (demo_session set) stay out of public listings.
  return query<Shop>(
    `select ${SHOP_COLS} from shops where status = 'published' and demo_session is null order by published_at desc`,
  );
}

/** Creates a draft shop with a unique slug. Returns the shop AND its edit_token (show to seller once). */
export async function createShop(input: {
  name: string;
  tagline?: string | null;
  about?: string | null;
  location?: string | null;
  paypal_email?: string | null;
  source_url?: string | null;
  /** /try judge demo session id: the shop is visible only to that session's searches. */
  demo_session?: string | null;
}) {
  // /try demo copies get their own slug space so they never take a real shop's slug (e.g. "hanul-clay").
  const base = input.demo_session
    ? `${slugify(input.name).slice(0, 36)}-try-${input.demo_session.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`
    : slugify(input.name);
  let slug = base;
  for (let i = 2; await getShopBySlug(slug); i++) slug = `${base}-${i}`;
  return (await queryOne<Shop & { edit_token: string }>(
    `insert into shops (slug, name, tagline, about, location, paypal_email, source_url, demo_session)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${SHOP_COLS}, edit_token`,
    [slug, input.name, input.tagline ?? null, input.about ?? null, input.location ?? null, input.paypal_email ?? null, input.source_url ?? null,
     input.demo_session ?? null],
  ))!;
}

export async function updateShop(
  id: string,
  patch: Partial<Pick<Shop, "name" | "tagline" | "about" | "location" | "paypal_email">>,
) {
  const keys = Object.keys(patch).filter((k) => ["name", "tagline", "about", "location", "paypal_email"].includes(k));
  if (keys.length === 0) return getShopById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  return queryOne<Shop>(`update shops set ${sets} where id = $1 returning ${SHOP_COLS}`, [
    id,
    ...keys.map((k) => (patch as Record<string, unknown>)[k]),
  ]);
}

export async function publishShop(id: string) {
  return queryOne<Shop>(
    `update shops set status = 'published', published_at = coalesce(published_at, now()) where id = $1 returning ${SHOP_COLS}`,
    [id],
  );
}

export async function unpublishShop(id: string) {
  return queryOne<Shop>(`update shops set status = 'draft' where id = $1 returning ${SHOP_COLS}`, [id]);
}

/** Constant-time-ish check of a seller's token. */
export async function checkShopToken(shopId: string, token: string | null | undefined) {
  if (!token) return false;
  const row = await queryOne<{ ok: boolean }>(`select edit_token = $2 as ok from shops where id = $1`, [shopId, token]);
  return row?.ok === true;
}

// ---------- products ----------

export async function listProducts(shopId: string) {
  return (await query(`select * from products where shop_id = $1 order by created_at, title`, [shopId])).map(toProduct);
}

/**
 * All products of published shops, with shop info, for agent search.
 * No session: every real shop, never /try demo shops. With a /try session: seed shops plus that session's own
 * demo shops only (so a judge's before/after isn't spoiled by real published shops or other judges).
 */
export async function listSearchableProducts(opts: { session?: string | null } = {}) {
  const session = opts.session ?? null;
  const rows = await query(
    `select p.*, s.name as shop_name, s.slug as shop_slug, s.location as shop_location, s.published_at as shop_published_at
       from products p join shops s on s.id = p.shop_id
      where s.status = 'published' and p.stock > 0
        and (case when $1::text is null then s.demo_session is null
                  else (s.demo_session = $1::text or (s.demo_session is null and s.source_url = 'seed')) end)
      order by s.published_at desc nulls last
      limit 500`,
    [session],
  );
  return rows.map((r) => ({
    ...toProduct(r),
    shop_name: r.shop_name as string,
    shop_slug: r.shop_slug as string,
    shop_location: (r.shop_location as string | null) ?? null,
    shop_published_at: r.shop_published_at ? new Date(r.shop_published_at as string | Date).toISOString() : null,
  }));
}
export type SearchableProduct = Awaited<ReturnType<typeof listSearchableProducts>>[number];

export async function getProduct(id: string) {
  const r = await queryOne(`select * from products where id = $1`, [id]);
  return r ? toProduct(r) : null;
}

export async function getProductWithShop(id: string) {
  const product = await getProduct(id);
  if (!product) return null;
  const shop = await getShopById(product.shop_id);
  return shop ? { product, shop } : null;
}

export async function insertProducts(shopId: string, drafts: DraftProduct[]) {
  const out: Product[] = [];
  for (const d of drafts) {
    const r = await queryOne(
      `insert into products (shop_id, title, description, price, currency, image_url, tags, attributes, ai_fields,
                             market_low, market_median, market_high, stock)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [shopId, d.title, d.description, d.price ?? 0, d.currency || "USD", d.image_url, d.tags, JSON.stringify(d.attributes ?? {}),
       d.ai_fields, d.market_low, d.market_median, d.market_high, d.stock ?? 10],
    );
    out.push(toProduct(r!));
  }
  return out;
}

const PRODUCT_EDITABLE = ["title", "description", "price", "currency", "image_url", "tags", "attributes", "ai_fields", "stock"] as const;

export async function updateProduct(id: string, patch: Partial<Pick<Product, (typeof PRODUCT_EDITABLE)[number]>>) {
  const keys = Object.keys(patch).filter((k) => (PRODUCT_EDITABLE as readonly string[]).includes(k));
  if (keys.length === 0) return getProduct(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const vals = keys.map((k) => {
    const v = (patch as Record<string, unknown>)[k];
    return k === "attributes" ? JSON.stringify(v ?? {}) : v;
  });
  const r = await queryOne(`update products set ${sets}, updated_at = now() where id = $1 returning *`, [id, ...vals]);
  return r ? toProduct(r) : null;
}

export async function deleteProduct(id: string) {
  await query(`delete from products where id = $1 and not exists (select 1 from orders where product_id = $1)`, [id]);
}

// ---------- searches ----------

export async function logSearch(s: {
  query: string;
  max_price?: number | null;
  client_name?: string | null;
  shelf_hit_count: number;
  market_hit_count: number;
  top_product_id?: string | null;
}) {
  await query(
    `insert into searches (query, max_price, client_name, shelf_hit_count, market_hit_count, top_product_id)
     values ($1,$2,$3,$4,$5,$6)`,
    [s.query, s.max_price ?? null, s.client_name ?? null, s.shelf_hit_count, s.market_hit_count, s.top_product_id ?? null],
  );
}

/** Recent network-wide agent searches (demand signal for every seller). */
export async function listRecentSearches(limit = 200) {
  return (await query(`select * from searches order by created_at desc limit $1`, [limit])).map(toSearch);
}

/** Searches whose top Shelf hit was one of this shop's products. */
export async function listShopSearches(shopId: string, limit = 200) {
  return (
    await query(
      `select se.* from searches se join products p on p.id = se.top_product_id
        where p.shop_id = $1 order by se.created_at desc limit $2`,
      [shopId, limit],
    )
  ).map(toSearch);
}

// ---------- orders ----------

export async function createOrderRow(o: {
  product_id: string;
  shop_id: string;
  qty: number;
  amount: number;
  currency: string;
  client_name?: string | null;
  query?: string | null;
  gift_note?: string | null;
  ship_to_name?: string | null;
}) {
  return toOrder(
    (await queryOne(
      `insert into orders (product_id, shop_id, qty, amount, currency, client_name, query, gift_note, ship_to_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [o.product_id, o.shop_id, o.qty, o.amount, o.currency, o.client_name ?? null, o.query ?? null, o.gift_note ?? null, o.ship_to_name ?? null],
    ))!,
  );
}

export async function setOrderPaypalId(id: string, paypalOrderId: string) {
  const r = await queryOne(`update orders set paypal_order_id = $2 where id = $1 returning *`, [id, paypalOrderId]);
  return r ? toOrder(r) : null;
}

export async function getOrderById(id: string) {
  const r = await queryOne(`select * from orders where id = $1`, [id]);
  return r ? toOrder(r) : null;
}

export async function getOrderByPaypalId(paypalOrderId: string) {
  const r = await queryOne(`select * from orders where paypal_order_id = $1`, [paypalOrderId]);
  return r ? toOrder(r) : null;
}

/** Status transition. Never downgrades 'paid'/'refunded' back to earlier states. */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  extra: { capture_id?: string | null; payer_email?: string | null; ship_to_name?: string | null } = {},
) {
  const r = await queryOne(
    `update orders set
        status = case
          when status = 'refunded' then status
          when status = 'paid' and $2 not in ('refunded') then status
          else $2 end,
        capture_id = coalesce($3, capture_id),
        payer_email = coalesce($4, payer_email),
        ship_to_name = coalesce($5, ship_to_name),
        paid_at = case when $2 = 'paid' and paid_at is null then now() else paid_at end
      where id = $1 returning *`,
    [id, status, extra.capture_id ?? null, extra.payer_email ?? null, extra.ship_to_name ?? null],
  );
  return r ? toOrder(r) : null;
}

export async function listOrders(shopId: string, limit = 200) {
  return (
    await query(
      `select o.*, p.title as product_title from orders o join products p on p.id = o.product_id
        where o.shop_id = $1 order by o.created_at desc limit $2`,
      [shopId, limit],
    )
  ).map((r) => ({ ...toOrder(r), product_title: r.product_title as string }));
}

// ---------- webhooks ----------

/** Returns true if this event id is new (first delivery), false if already processed. */
export async function recordWebhookEvent(e: { id: string; event_type: string; resource_id?: string | null; payload: unknown }) {
  const rows = await query(
    `insert into webhook_events (id, event_type, resource_id, payload) values ($1,$2,$3,$4)
     on conflict (id) do nothing returning id`,
    [e.id, e.event_type, e.resource_id ?? null, JSON.stringify(e.payload)],
  );
  return rows.length > 0;
}

// ---------- appended by module A (PayPal) ----------

/** Order by PayPal capture id (refund / reversal webhooks reference the capture, not the order). */
export async function getOrderByCaptureId(captureId: string) {
  const r = await queryOne(`select * from orders where capture_id = $1`, [captureId]);
  return r ? toOrder(r) : null;
}

/** Hard-deletes a shop with its orders and products (test cleanup). Orders go first: orders→products is RESTRICT. */
export async function deleteShopWithOrders(shopId: string) {
  await query(`delete from orders where shop_id = $1`, [shopId]);
  await query(`delete from shops where id = $1`, [shopId]);
}

// ---------- appended by the integrator ----------

/**
 * The shopper query that most recently surfaced this product in the last hour (for "what they asked" on orders
 * after a restart wiped the in-memory map). Prefers searches where it was the top hit, then any recent search
 * whose top hit came from the same shop.
 */
export async function recentQueryForProduct(productId: string) {
  const r = await queryOne<{ query: string }>(
    `select se.query from searches se
       join products top on top.id = se.top_product_id
       join products p on p.id = $1
      where se.created_at > now() - interval '1 hour' and top.shop_id = p.shop_id
      order by (se.top_product_id = $1) desc, se.created_at desc
      limit 1`,
    [productId],
  );
  return r?.query ?? null;
}

// ---------- appended by A4 (/try one-link judge demo) ----------

/** True if the shop was created from /try (a judge's throwaway demo copy). */
export async function isDemoShop(shopId: string) {
  const r = await queryOne<{ demo: boolean }>(`select demo_session is not null as demo from shops where id = $1`, [shopId]);
  return r?.demo === true;
}

/** The most recent shop created by this /try session, with its edit token (server-side only). */
export async function getDemoSessionShop(session: string) {
  return queryOne<Shop & { edit_token: string }>(
    `select ${SHOP_COLS}, edit_token from shops where demo_session = $1 order by created_at desc limit 1`,
    [session],
  );
}

/** Deletes /try demo shops older than `hours` (orders first: orders→products is RESTRICT). Returns how many. */
export async function deleteStaleDemoShops(hours = 12) {
  const stale = await query<{ id: string }>(
    `select id from shops where demo_session is not null and created_at < now() - make_interval(hours => $1::int)`,
    [hours],
  );
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.id);
  await query(`delete from orders where shop_id = any($1::uuid[])`, [ids]);
  await query(`delete from shops where id = any($1::uuid[])`, [ids]);
  return ids.length;
}
