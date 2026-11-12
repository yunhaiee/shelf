# Shelf — module contracts (read before writing code)

Product, pitch, demo script: `docs/PLAN.md`. Stack: Next.js 15 App Router (TypeScript, Tailwind v4), Postgres on
Render, deployed as ONE Node web service on Render. Env vars live in `.env` (never hardcode, never print secrets):
`PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID (set after deploy), SELLER_PAYPAL_EMAIL,
PLATFORM_PAYPAL_EMAIL, BUYER_PAYPAL_EMAIL, BUYER_PAYPAL_PASSWORD, CHANNEL3_API_KEY, ANTHROPIC_API_KEY,
DATABASE_URL, APP_URL` (APP_URL = public base URL, `http://localhost:3000` locally).

## Already built — use, don't rewrite
- `lib/db.ts` — `query`, `queryOne`, `pool` (Render Postgres, SSL).
- `lib/types.ts` — `Shop, Product, DraftProduct, Order, OrderStatus, SearchLog, SearchHit, ProductAttributes`.
- `lib/repo.ts` — ALL SQL lives here. Shops (`createShop` returns `edit_token` once, `getShopBySlug/ById`,
  `updateShop`, `publishShop`, `unpublishShop`, `checkShopToken`), products (`listProducts`,
  `listSearchableProducts` → `SearchableProduct` = Product + shop_name/shop_slug/shop_location/shop_published_at,
  `getProduct`, `getProductWithShop`, `insertProducts`, `updateProduct`, `deleteProduct`), searches (`logSearch`,
  `listRecentSearches`, `listShopSearches`), orders (`createOrderRow`, `setOrderPaypalId`, `getOrderById`,
  `getOrderByPaypalId`, `updateOrderStatus` (never downgrades paid/refunded), `listOrders` (+product_title)),
  `recordWebhookEvent` (true = first delivery). If you need a new query, ADD a function to repo.ts (append only,
  don't change existing signatures).
- `lib/channel3.ts` — `searchMarket(query,{maxPrice,limit,agentic})` → `MarketItem[]`, `priceComps(title)` →
  `{n,low,median,high,examples}|null`.
- `db/schema.sql` + `scripts/migrate.mts` (already applied to the live DB).

Imports inside `lib/` and `app/` use the `@/` alias or relative paths WITHOUT extensions (Next resolves them).
Standalone scripts in `scripts/*.mts` run with `npx tsx --env-file=.env scripts/x.mts` and import with explicit
`.ts` extensions (e.g. `../lib/repo.ts`). Server-only modules must never be imported by client components.

## Module ownership (each builder touches ONLY its files; shared files above are read-only)

### A. PayPal — `lib/paypal.ts`, `lib/checkout.ts`, `app/api/paypal/return/route.ts`, `app/api/paypal/webhook/route.ts`, `app/paid/page.tsx`, `scripts/register-webhook.mts`, `scripts/test-paypal.mts`
Use `@paypal/paypal-server-sdk` (APIMatic-generated) for Orders v2 (create, get, capture) and Payments (refund).
Plain fetch is OK only for endpoints the SDK lacks (webhook signature verification, webhook registration).
`lib/checkout.ts` exports (used by the MCP server and dashboard):
```ts
createCheckout(i: { productId: string; qty?: number; clientName?: string|null; query?: string|null;
                   giftNote?: string|null; shipToName?: string|null })
  : Promise<{ order: Order; approveUrl: string; product: Product; shop: Shop }>
  // throws Error with a human-readable message if product missing / out of stock / shop unpublished / no paypal_email
getCheckoutStatus(orderId: string)          // Shelf order uuid OR PayPal order id
  : Promise<{ order: Order; product: Product; shop: Shop } | null>
  // if local status is 'created', refresh from PayPal (GET order) so APPROVED/COMPLETED is reflected
captureCheckout(paypalOrderId: string): Promise<Order>   // idempotent; marks 'paid' with capture_id + payer_email
refundOrder(orderId: string): Promise<Order>             // full refund of the capture → 'refunded'
```
Order body: intent CAPTURE; one purchase unit with `payee.email_address = shop.paypal_email` (money goes straight
to the seller), `reference_id`/`custom_id` = Shelf order id, item list (name, unit_amount, quantity, category
PHYSICAL_GOODS), amount breakdown item_total. Experience context: brand_name "Shelf · {shop.name}",
user_action PAY_NOW, shipping_preference GET_FROM_FILE, return_url `${APP_URL}/api/paypal/return?order={id}`,
cancel_url `${APP_URL}/paid?order={id}&cancelled=1`. approveUrl = the `payer-action` (or `approve`) link.
Return route: capture (idempotent) then redirect to `/paid?order={id}`. `/paid` page: calm confirmation —
"Payment approved. You can go back to your assistant." with order summary (server component, reads repo).
Webhook route: verify signature via `POST /v1/notifications/verify-webhook-signature` using PAYPAL_WEBHOOK_ID
(if PAYPAL_WEBHOOK_ID unset, log a warning and reject in production / accept in dev), dedupe via
`recordWebhookEvent`, handle CHECKOUT.ORDER.APPROVED (capture), PAYMENT.CAPTURE.COMPLETED (paid),
PAYMENT.CAPTURE.REFUNDED / PAYMENT.CAPTURE.REVERSED (refunded), PAYMENT.CAPTURE.DENIED (failed). Always 200 fast.
`scripts/register-webhook.mts`: registers `${APP_URL}/api/paypal/webhook` for those events, prints the webhook id
to put in PAYPAL_WEBHOOK_ID (reuse existing webhook with same URL if present).
`scripts/test-paypal.mts`: creates a temp shop+product with SELLER_PAYPAL_EMAIL, calls createCheckout, prints the
approve URL, GETs the order to confirm status CREATED/PAYER_ACTION_REQUIRED and payee email, then cleans up.

### B. Search + MCP — `lib/search.ts`, `lib/mcp.ts`, `app/api/mcp/route.ts`, `scripts/test-mcp.mts`
`lib/search.ts`:
```ts
searchShelf(query: string, opts?: { maxPrice?: number|null; limit?: number }): Promise<Extract<SearchHit,{source:"shelf"}>[]>
searchAll(query: string, opts?: { maxPrice?: number|null; clientName?: string|null })
  : Promise<{ shelf: ShelfHit[]; market: MarketHit[] }>   // runs shelf + Channel3 in parallel, then logSearch()
```
Shelf ranking: load `listSearchableProducts()`, prefilter by maxPrice, cheap lexical score over
title/description/tags/attributes/shop; then rank the top ~30 candidates with Claude (claude-haiku-5-5, structured
JSON output) returning relevant product ids + a ≤15-word `why`. Drop irrelevant products — a mug query must not
return candles. Fall back to lexical ranking if the AI call fails or times out (~6s). Channel3 failure must not
break search (return market: []).
MCP server (`@modelcontextprotocol/sdk` v1.32, `McpServer` + `WebStandardStreamableHTTPServerTransport` from
`@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`, STATELESS: new server+transport per request,
`sessionIdGenerator: undefined`, `enableJsonResponse: true`). Route handles POST (and GET/DELETE → 405 JSON-RPC
error). Must work as a Claude Desktop "custom connector" (remote MCP over HTTPS, no auth). Server name "shelf",
with `instructions` explaining: Shelf = independent small shops buyable in chat via PayPal; always show the
approval link; never claim payment until check_order says paid.
Tools (zod input schemas, clear descriptions; return text content + structuredContent):
- `search_products {query, max_price?}` → Shelf hits first (buyable in chat) then market results (Channel3,
  link-out only, clearly labeled). Text output readable by the model: numbered list with product_id, price, shop,
  why. Note "published N minutes ago" for shops published < 1h ago.
- `get_product {product_id}` → full details (description, attributes, care, dimensions, stock, shop about/location).
- `create_checkout {product_id, quantity?, gift_note?, ship_to_name?}` → calls `createCheckout`; returns approve
  URL with instruction "Ask the buyer to open this PayPal link and approve; then call check_order".
- `check_order {order_id}` → `getCheckoutStatus`; status, amount, shop, paid time.
Client attribution: `clientName` from the request's `initialize` clientInfo if present, else derived from the
User-Agent header (e.g. contains "Claude" → "Claude"), else "AI agent". Pass `query` (last search) when possible.
`scripts/test-mcp.mts`: speaks MCP over HTTP to `${APP_URL}/api/mcp` with the SDK Client +
StreamableHTTPClientTransport: list tools, call search_products. (Run only if a dev server is up; otherwise test
lib/search.ts directly.)

### C. Seller AI + seller API — `lib/ai.ts`, `lib/importer.ts`, `lib/auth.ts`, `app/api/import/route.ts`, `app/api/shops/route.ts`, `app/api/shops/[id]/route.ts`, `app/api/shops/[id]/products/route.ts`, `app/api/shops/[id]/products/[productId]/route.ts`, `app/api/shops/[id]/publish/route.ts`, `app/api/shops/[id]/insights/route.ts`, `scripts/test-import.mts`
Use the Anthropic TS SDK (`@anthropic-ai/sdk`) — invoke the `claude-api` skill first for correct current usage
(structured outputs / tool use, model ids). Models: `claude-sonnet-5-5` for extraction, `claude-haiku-5-5` for
small calls.
`lib/importer.ts`: `importCatalog(input: { url?: string; text?: string }): Promise<{ shop: { name, tagline,
about, location }, products: DraftProduct[] }>`. URL: fetch with 10s timeout, http/https only, block
localhost/private IP ranges EXCEPT when NODE_ENV !== 'production' (so a local demo shop works), cap 2MB,
extract visible text + JSON-LD + <img src alt> (absolute URLs) + og tags, send to Claude. Text: messy pasted list
(Instagram caption style, "speckled mug 28 / blue bowl $34"). Claude extracts shop info + products, matching
image URLs to products when present. Then enrichment: for each product, agent-readable `tags` (6–10: use case,
style, material, gift suitability), `attributes` (material, color, dimensions, capacity, care, handmade), a clean
2–3 sentence description if missing/weak. `ai_fields` lists every field the AI filled or rewrote (e.g.
["description","tags","attributes.care","price"]). Then Channel3 `priceComps(title + material)` in parallel
(concurrency 4) → market_low/median/high; if price missing → price = round(median) and add "price" to ai_fields.
`lib/ai.ts`: shared Anthropic client + `demandInsights(shop, products, searches)` → up to 3
`{ headline, detail, query_examples: string[], count }` (e.g. "Agents asked for 'speckled bowl' 9× — you don't
sell one"), using network-wide `listRecentSearches()` filtered to the shop's category by the model.
`lib/auth.ts`: `requireShop(req, shopId)` → reads token from `x-shop-token` header or cookie
`shelf_token_{shopId}`; 401 JSON if invalid. `setShopCookie(res, shopId, token)` (httpOnly, sameSite lax, 30d).
API (JSON; errors `{ error: string }` with proper status):
- `POST /api/import` `{url?|text?}` → `{ shop: {...}, products: DraftProduct[] }` (no DB write; may take ~15–40s).
  With `Accept: application/x-ndjson` it streams real progress instead: `{type:"stage",stage:"read"|"write"|"prices",
  done?,total?}` lines, then `{type:"result",shop,products}` or `{type:"error",status,error}`.
- `POST /api/shops` `{ shop: {name,tagline,about,location,paypal_email,source_url}, products: DraftProduct[] }`
  → creates draft shop + products, sets cookie, → `{ shop, products, token }`
- `GET /api/shops/[id]` (token) → `{ shop, products }`
- `PATCH /api/shops/[id]` (token) `{ name?, tagline?, about?, location?, paypal_email? }` → `{ shop }`
- `POST /api/shops/[id]/products` (token) `DraftProduct` → `{ product }`
- `PATCH /api/shops/[id]/products/[productId]` (token) partial product → `{ product }` (when a seller edits a
  field, remove it from ai_fields); `DELETE` → 204
- `POST /api/shops/[id]/publish` (token) → validates (≥1 product, all prices > 0, paypal_email set) →
  `{ shop }`; `DELETE` → unpublish
- `GET /api/shops/[id]/insights` (token) → `{ insights }`
`scripts/test-import.mts`: runs importCatalog on a sample messy text list and prints the result.

### D. Frontend — `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `app/sell/**`, `app/dash/**`, `app/s/**`, `app/llms.txt/route.ts`, `app/api/dash/[id]/route.ts`, `components/**`
Talks to C's API exactly as specified above (don't import server modules into client components).
`GET /api/dash/[id]` (owned by D; token via lib/auth.ts `requireShop`) → `{ shop, orders (with product_title),
searches: listShopSearches, network: listRecentSearches(100) }`; dashboard polls it every 2s. `GET /api/dash/demo` (+ `/api/dash/demo/insights`, cached 5 min) is the public,
read-only, redacted feed of the published demo shop (`DEMO_SHOP_SLUG`, default `hanul-clay`), rendered at `/dash/demo`.
Pages:
- `/` landing: text-led pitch, two entry points — "Open your shop" (/sell) and "Connect Shelf to Claude"
  (shows the MCP URL `${APP_URL}/api/mcp` with copy button + 3-step Claude Desktop instructions:
  Settings → Connectors → Add custom connector). Also lists published shops.
- `/sell` (client): step 1 paste a link OR text → POST /api/import (show honest progress: "Reading your shop…",
  "Writing agent-ready details…", "Checking market prices with Channel3…"); step 2 AG Grid catalog editor
  (editable title, price, description, tags, stock; image thumbnail; market range column "Channel3 $12–$28,
  median $19"; cells listed in ai_fields get a subtle highlight + small "AI" marker; edits clear it); shop name /
  about / PayPal email fields above the grid (prefill PayPal email with nothing — seller types it); step 3
  "Publish to Shelf" → POST /api/shops then POST /api/shops/[id]/publish → success state: "Live. Any assistant
  connected to Shelf can find and buy from {name} now." + link to dashboard `/dash/[id]` and public page.
  Keep the token (returned + cookie) and also store in localStorage `shelf_token_{id}`; send `x-shop-token`.
- `/dash/[id]` (client): header with shop name + live status; AG Grid "Orders" (time, product, qty, amount,
  status pill, assistant = client_name, what they asked = query) — new/changed rows flash (getRowId +
  `api.flashCells`), "Agent demand" grid (network searches: query, max price, when, matched you? yes/no), and an
  "Insights" panel from GET /api/shops/[id]/insights (button "Analyze demand"). Polls /api/dash/[id] every 2s.
- `/s/[slug]` (server): public shop page with products + schema.org `Product`/`Offer` JSON-LD per product and a
  line "Buy from this shop inside Claude: connect Shelf". `/llms.txt`: plain text describing Shelf, the MCP
  endpoint, and listing published shops with product lines.
AG Grid v36: `import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community"`,
`ModuleRegistry.registerModules([AllCommunityModule])`, `<AgGridReact theme={themeQuartz.withParams({...})}>`.
Community features only.
**Design (locked palette, user's taste):** text-led minimalism — clean typography, small uppercase eyebrow
labels, tight alignment, generous whitespace. NO icon grids, NO decorative icons/emoji, NO heavy card containers
or gradients, no drop-shadow cards. Hairline rules to separate sections. Fonts via next/font/google: "Instrument
Serif" for display headings, "Inter" for UI/body, "JetBrains Mono" for ids/URLs/prices-in-grid.
Palette (CSS variables in globals.css; use nowhere else hex literals):
`--bg #FAF8F4; --surface #FFFFFF; --ink #1C1B19; --muted #6B675F; --line #E6E1D8; --accent #9A4A2B (clay);
--accent-soft #F3E6DE; --ai #EEF0FB (AI-filled cell highlight); --ai-ink #3B47A8; --ok #2F6B45; --warn #9A6B12`.
AG Grid theme params derived from these (no blue default accent). Light theme only. Must work at phone width.

### E. Demo assets + infra — `demo-shop/**`, `scripts/seed.mts`, `render.yaml`, `LICENSE`, `README.md`, `docs/DEMO.md`, `docs/SUBMISSION.md`
- `demo-shop/`: a static website for the fictional ceramic studio **"Hanul Clay"** (small studio, made-up
  location e.g. "Oakland, CA"; maker "Mina" is fictional) that looks like a real small-maker site (plain HTML/CSS,
  its own modest style — NOT Shelf's design). 6 products (speckled mug, blue celadon cup, oatmeal-glaze bowl,
  small bud vase, set of two espresso cups, serving platter), each with name, price in USD (one product
  intentionally without price), a casual description that omits details agents need (dimensions/care partially
  missing), and an image. Images: tasteful hand-made SVG illustrations of each piece (speckled glaze via
  noise/dots, soft shadows) saved as `demo-shop/img/*.svg`, referenced with relative <img> tags; add schema-free
  markup on purpose (the point is that Shelf's AI reads a messy real site). Also `demo-shop/instagram.txt`: the
  same catalog as a messy Instagram-caption-style text list (for the paste path).
- `scripts/seed.mts`: idempotent seeding of 4 OTHER fictional published shops on Shelf so the network looks real
  (e.g. a candle maker, a linen/textile weaver, a small-batch coffee roaster, a letterpress card studio — NOT
  ceramics/mugs, so the demo search only matches Hanul Clay after it publishes), 4–6 products each with
  realistic prices/tags/attributes, paypal_email = SELLER_PAYPAL_EMAIL, image_url null or SVG data URIs; plus
  ~40 realistic network search-log rows over the past 7 days (client_name "Claude"/"ChatGPT"/"AI agent"),
  including several ceramics queries Shelf couldn't serve ("speckled ceramic mug gift", "handmade stoneware
  bowl", "speckled bowl", "small studio ceramics under $40", "celadon cup"). Seeds must be marked
  `source_url = 'seed'` and the script must print each seeded shop's edit token. Re-running must not duplicate.
  Also a `--reset-demo` flag that deletes the "Hanul Clay" shop (and its orders) so the demo can be re-recorded.
- `render.yaml` Blueprint: web service `shelf` (node, `npm ci && npm run build`, `npm start`, env vars listed with
  `sync: false` for secrets, APP_URL), static site `hanul-clay` (rootDir demo-shop, publishPath .), and reference
  the existing external database via DATABASE_URL env (do NOT create a new DB in the blueprint).
- `LICENSE`: MIT, copyright 2026 Yunha Lee.
- `README.md`: judge-facing. What Shelf is, the problem, demo video placeholder, hosted URL placeholder,
  architecture diagram (from PLAN.md), exactly how PayPal is used (Orders v2 with payee routing, approval links,
  capture, webhooks w/ signature verification, refunds, `@paypal/paypal-server-sdk` generated by APIMatic), how AI
  is used (Claude Sonnet 5.5 extraction/enrichment, Claude Haiku 5.5 search ranking + demand insights), how each
  sponsor tool is used (AG Grid ×3 grids, Channel3 search + price comps, APIMatic SDK, Render hosting), MCP tools,
  local setup + run steps (env vars table, migrate, seed, dev, register webhook), how to connect Claude Desktop,
  how to test in sandbox (buyer account), limitations/roadmap (open-web discovery, Channel3/merchant feeds,
  platform fees via PayPal partner onboarding). Mark seed data as demo data. Never include real secrets.
- `docs/DEMO.md`: the < 3:00 video script (shot list with timings + voiceover lines) following PLAN.md's flow with
  the honest opening: Claude can find small shops only as links out; after publishing, Hanul Clay is found AND
  bought in-chat with PayPal.
- `docs/SUBMISSION.md`: Devpost text — tagline, inspiration, what it does, how we built it, challenges,
  accomplishments, what we learned, what's next, "Built with" list, and the required "Tools used" section.

## Rules for all builders
- Do NOT run `npm install` (all deps are installed: next 15.5, react 19.1, pg, @paypal/paypal-server-sdk 2.5,
  @modelcontextprotocol/sdk 1.32, @anthropic-ai/sdk, @channel3/sdk 4.9, ag-grid-community/react 36, zod 4, tsx).
  If you truly need another package, say so in your final report instead.
- Do NOT run `next build` or `next dev` (other builders are working in the same tree). Verify with
  `npx tsc --noEmit -p .` (ignore errors in files you don't own) and your own `scripts/*.mts` smoke tests.
- Don't touch files you don't own. Never print or commit secrets. Don't git commit.
- Read the actual installed package types in node_modules before using an API you aren't sure of.
