# Shelf

**Agentic commerce is being built for sellers with catalogs. Shelf is for the ones who sell from a caption.**

**Demo link: https://shelf-ltfn.onrender.com/try — the whole flow in one page, nothing to install.**

A seller pastes their Instagram caption (or a messy product list, or a shop link). Shelf's AI turns it into an
agent-ready catalog, Channel3 suggests prices, and on Publish the shop is searchable **and buyable** inside any AI assistant connected to
Shelf. Checkout runs through PayPal: the buyer approves every payment, and the money goes straight to the
seller's own PayPal account.

- One-page demo: https://shelf-ltfn.onrender.com/try
- Demo video (under 3 minutes): `<VIDEO_URL>`
- Hosted app: https://shelf-ltfn.onrender.com
- MCP endpoint (for Claude Desktop): `https://shelf-ltfn.onrender.com/api/mcp`
- Fictional demo shop (link-in-bio page, the fallback import source): https://hanul-clay.onrender.com

Built for the PayPal AI Hackathon. MIT licensed.

---

## The problem

People now ask AI assistants to shop for them. Ask for a handmade mug from a small studio and you get links out
to other sites; the assistant can't buy from a small maker. Agentic checkout is arriving for merchants who
already have a catalog or a storefront. A one-person pottery studio has an Instagram caption that ends "DM to
order, I'll send a PayPal invoice!".

Shelf closes that gap from both sides:

- **Sellers** never write a feed or an API. They paste what they already have.
- **Shoppers** connect Shelf to their assistant once. Every published shop becomes buyable in chat.
- **Payments** stay with PayPal. The buyer approves on PayPal, the seller is the payee, and Shelf never holds
  the money.

## What it does

**For a seller** (`/sell`)
1. Paste an Instagram caption or a text list ("speckled mug 28 (the everyday one, big coffee size) / big oval
   serving platter… DM for price"), or a shop URL.
2. Claude extracts the shop and its products, then rewrites them for agents: clean descriptions, 6 to 10 tags
   (use case, style, material, gift suitability) and structured attributes (material, color, dimensions,
   capacity, care, handmade). Channel3 returns market price comps for every product, and a missing price is
   filled from the market median.
3. Review everything in an AG Grid catalog editor. Cells the AI filled are highlighted with an "AI" marker; when
   the seller edits a cell, the marker clears.
4. Add a PayPal email and press **Publish to Shelf**. The shop is live for agents right away, and the seller
   gets an agent-ready page (`/s/[slug]`) to put in their Instagram bio.

**For a shopper** (any MCP client: Claude Desktop with Shelf added as a custom connector, or the in-page Claude
on `/try`, which reaches the same endpoint through the Claude API MCP connector)
1. "Use Shelf to find me a speckled mug from a small studio, under $40."
2. `search_products` returns Shelf shops first (buyable in chat), then wider-market results from Channel3,
   clearly labeled as link-out only.
3. `create_checkout` creates a PayPal order with the seller as payee, optionally with a ship-to address the agent
   sets (a gift goes straight to the recipient), and returns a PayPal approval link.
4. The buyer approves on PayPal with one tap. Shelf captures the payment, and `check_order` confirms "paid".

**One-page demo** (`/try`): paste Mina's caption → Import (Claude + Channel3) → Publish (a shop private to your
browser session) → ask the in-page Claude, connected to Shelf over MCP → approve in the PayPal Sandbox with the
test buyer shown on the page → the seller's orders grid flashes paid.

**For the seller, after publishing** (`/dash/[id]`)
- Live **Orders** grid: rows flash as soon as PayPal confirms the capture (the buyer's return redirect or the
  verified webhook, whichever lands first; the dashboard polls every 2 seconds). It shows which assistant placed
  the order and what the shopper asked for.
- **Agent demand** grid: what assistants searched for across the network, and whether this shop matched.
- **Insights**: Claude reads the network's agent searches and points out demand the shop isn't meeting
  (e.g. "Agents asked for 'speckled bowl' 5 times this week").
- Each seller's dashboard is private (a per-shop key). The demo shop's dashboard is also open read-only at
  `/dash/demo`, with the seller's PayPal email and buyer details withheld, so anyone can watch a test order land.

**For the open web**: each shop has a public page at `/s/[slug]` with schema.org `Product`/`Offer` JSON-LD, and
`/llms.txt` lists the MCP endpoint and every published shop.

## Architecture

```
 SELLER (browser)                          SHOPPER (Claude Desktop connector, or Claude API
   │ paste caption / list / link              │  MCP connector on /try)
   ▼                                          ▼  "Use Shelf to find a speckled mug under $40"
 ┌──────────────────── Shelf: one Next.js service on Render ───────────────────────────┐
 │ /sell      import ─► Claude: extract + enrich ─► Channel3 price comps                │
 │            AG Grid catalog editor (AI cells highlighted) ─► Publish                   │
 │ /api/mcp   MCP server (streamable HTTP)                                               │
 │            search_products ─► Shelf shops (Postgres)  +  Channel3 market (links out)  │
 │            get_product · create_checkout · check_order                               │
 │            every query logged ─► demand insights                                      │
 │ /api/paypal/return   capture ─► order paid ─► "Payment approved."                     │
 │ /api/paypal/webhook  verify ─► dedupe ─► paid / refunded / failed (backup path)       │
 │ /dash      AG Grid: Orders (live, which assistant) · Agent demand (unmet searches)    │
 │ /s/[shop]  public page + schema.org JSON-LD + /llms.txt (open-web discovery)          │
 │ /try       one page: import ─► publish ─► in-page Claude (MCP) ─► PayPal ─► orders    │
 └──────┬──────────────────────┬──────────────────────────┬────────────────────────────┘
        ▼                      ▼                          ▼
  Render Postgres     PayPal Orders v2 (sandbox)     Claude API (Sonnet 5.5 / Haiku 5.5)
                      payee = seller · approve link   Channel3 API
                      capture · webhooks
```

Checkout flow:

```
Claude ─create_checkout─► Shelf ─POST /v2/checkout/orders (payee = seller, ship-to if set)─► PayPal
   ◄── approval link ────────┘
Buyer opens link ─► PayPal login + Approve ─► /api/paypal/return ─► capture ─► order = paid ─► /paid
PayPal ─PAYMENT.CAPTURE.COMPLETED webhook─► Shelf (verified, de-duplicated; confirms paid if the return never landed)
Seller dashboard (polls every 2s) ─► order row flashes as paid
Claude ─check_order─► "Paid."   (also captures an approved order itself if the buyer closed the tab early)
```

Stack: Next.js 15 (App Router, TypeScript, Tailwind v4), PostgreSQL on Render, one Node web service on Render.

## How PayPal is used

All PayPal calls go through [`@paypal/paypal-server-sdk`](https://www.npmjs.com/package/@paypal/paypal-server-sdk),
PayPal's official server SDK generated by APIMatic (`lib/paypal.ts`, `lib/checkout.ts`).

| What | How |
|---|---|
| **Orders v2: create** | `OrdersController.createOrder`, intent `CAPTURE`, one purchase unit with an item list (name, unit amount, quantity, category `PHYSICAL_GOODS`) and an `item_total` breakdown. `reference_id` / `custom_id` carry the Shelf order id. |
| **Payee routing** | `purchase_units[0].payee.email_address` is the seller's own PayPal email, so funds go straight to the seller. Shelf never holds money. |
| **Agent-set shipping** | When the agent passes a ship-to address, `purchase_units[0].shipping` carries the recipient's name and address and the shipping preference is `SET_PROVIDED_ADDRESS`, so PayPal shows it on the approval page. Without one, shipping comes from the buyer's PayPal profile (`GET_FROM_FILE`). |
| **Approval links** | Experience context: brand name `Shelf · {shop}`, `PAY_NOW`, return and cancel URLs. The `payer-action` link is what the assistant shows the buyer. |
| **Idempotency** | Create, capture and refund each send a `PayPal-Request-Id` (`create-`, `capture-`, `refund-{order id}`), so SDK retries and the return-URL / webhook / `check_order` race never double-charge or double-capture. |
| **Capture** | `/api/paypal/return` captures with `OrdersController.captureOrder` (idempotent), records capture id and payer email, then redirects to a calm `/paid` confirmation. |
| **Status** | `check_order` refreshes from `OrdersController.getOrder` while the local order is still `created`, so the assistant sees APPROVED or COMPLETED as soon as PayPal does. |
| **Webhooks** | `/api/paypal/webhook` verifies every event with `POST /v1/notifications/verify-webhook-signature`, de-duplicates by event id, and handles `CHECKOUT.ORDER.APPROVED` (capture), `PAYMENT.CAPTURE.COMPLETED` (paid), `PAYMENT.CAPTURE.REFUNDED` / `REVERSED` (refunded) and `PAYMENT.CAPTURE.DENIED` (failed). `scripts/register-webhook.mts` registers the endpoint. |
| **Refunds** | The capture belongs to the seller (payee routing), so the seller refunds from their own PayPal account; the webhook handler marks the order refunded when PayPal sends `PAYMENT.CAPTURE.REFUNDED` / `REVERSED` for the capture. We tested a platform-initiated refund (`PaymentsController.refundCapturedPayment`, `refundOrder` in `lib/checkout.ts`) on a payee-routed sandbox capture: PayPal returns `PERMISSION_DENIED` until the seller grants Shelf partner permission, so Shelf doesn't offer a refund button yet (see roadmap). |

The webhook-signature and webhook-registration endpoints are not in the SDK, so those two use `fetch` with the
same OAuth token.

The buyer always approves on PayPal. The assistant can't pay on its own, and the MCP server instructions tell
it never to claim an order is paid until `check_order` says so.

## How AI is used

- **Catalog extraction** (Claude Sonnet 5.5, `lib/importer.ts`): reads a shop page (visible text, JSON-LD, image
  tags, Open Graph) or a pasted list, and returns the shop plus structured products, matching images to products.
- **Enrichment for agents** (same pass): clean descriptions, agent-readable tags and attributes. Every field the
  AI wrote is recorded in `ai_fields`, so the seller can see exactly what was generated.
- **Search ranking** (Claude Haiku 5.5, `lib/search.ts`): a cheap lexical prefilter, then Claude ranks the top
  candidates and writes a short reason per hit. It drops irrelevant products, so a mug query doesn't return
  candles. If the model call fails or times out, search falls back to lexical ranking.
- **Demand insights** (Claude Haiku 5.5, `lib/ai.ts`): turns network-wide agent searches into up to three
  suggestions for a seller.
- **In-page assistant** (`/try`): Claude through the Claude API MCP connector, pointed at Shelf's public
  `/api/mcp`, so it uses the same four tools as Claude Desktop.

## Sponsor tools

- **PayPal**: Orders v2 (create, get, capture, with payee routing, agent-set shipping and idempotency keys),
  approval links, verified and de-duplicated webhooks (capture, refund, reversal and denial events) and the
  sandbox. See above.
- **APIMatic**: `@paypal/paypal-server-sdk` is APIMatic-generated. Its typed `OrdersController` and models are
  used for every Orders v2 call.
- **AG Grid** (Community, v36), three grids:
  1. Catalog editor on `/sell`: editable cells, AI-filled cells highlighted, Channel3 market range column.
  2. Live orders on `/dash/[id]` (and read-only at `/dash/demo`): rows flash on payment (`getRowId` +
     `flashCells`).
  3. Agent demand on `/dash/[id]`: network searches and whether this shop matched.
- **Channel3** (`@channel3/sdk`, `lib/channel3.ts`):
  1. Market results in agent search, labeled as link-out only, next to Shelf's buyable shops.
  2. Price comps (low / median / high) for every imported product in the catalog editor, plus a suggested price
     when the seller didn't list one.
- **Render**: the Next.js web service (seller UI, `/try`, MCP server, PayPal return and webhook endpoints),
  Render Postgres, and the static demo shop. See `render.yaml`.
- **Claude API**: Sonnet 5.5 and Haiku 5.5 (above), plus the MCP connector behind the `/try` assistant.

## MCP tools

Endpoint: `POST https://shelf-ltfn.onrender.com/api/mcp`. Stateless streamable HTTP, JSON responses, no auth. Server name `shelf`.

| Tool | Input | Returns |
|---|---|---|
| `search_products` | `query`, `max_price?` | Shelf hits first (product id, price, shop, why it matches, and "joined Shelf just now / N minutes ago" for shops published in the last hour), then Channel3 market results labeled link-out only |
| `get_product` | `product_id` | Full details: description, attributes, care, dimensions, stock, shop about and location |
| `create_checkout` | `product_id`, `quantity?`, `gift_note?`, `ship_to_name?`, optional ship-to address fields | PayPal approval URL plus the instruction to have the buyer approve, then call `check_order` |
| `check_order` | `order_id` (Shelf or PayPal id) | Status, amount, shop, paid time, ship-to |

Orders record which assistant placed them (MCP `clientInfo`, else the User-Agent) and the search that led there.

## Connect Claude Desktop

1. Claude Desktop → **Settings → Connectors → Add custom connector**.
2. Name it `Shelf`, URL `https://shelf-ltfn.onrender.com/api/mcp`.
3. In a new chat, start with "Use Shelf", e.g. "Use Shelf to find me a speckled mug from a small studio under
   $40." Without it, Claude sometimes answers from its own web search and never calls the connector.

## Try it in the PayPal sandbox

Everything runs against the PayPal **sandbox**. No real money moves. Render is on the free plan; a GitHub
Actions job pings it every 10 minutes, but the first load can still take up to a minute.

**Fastest: open https://shelf-ltfn.onrender.com/try.** Import Mina's caption, publish, ask the in-page Claude
for a gift, approve with the test buyer shown on the page, and watch the orders grid flash paid. Your shop is
private to your browser session.

**With Claude Desktop:**

1. Connect Claude Desktop (above) and search for a product.
2. Ask Claude to buy it, optionally with a ship-to address and a gift note. It returns a PayPal sandbox approval
   link.
3. Open the link and log in with a sandbox **personal** account. Judges can use
   the test buyer shown on `/try`, or any sandbox
   buyer from their own PayPal developer dashboard.
4. Approve. You land on Shelf's "Payment approved" page. Ask Claude to check the order: it reports paid.
5. Open `https://shelf-ltfn.onrender.com/dash/demo`, the demo shop's seller dashboard (read-only), to see your order with the
   assistant and what you asked. Open it before you approve to watch the row flash as paid. A shop you publish
   yourself gets its own private dashboard link after publishing.

## Run it locally

Requirements: Node 20+ (22 recommended), a PostgreSQL database, a PayPal developer account (sandbox app plus
seller and buyer sandbox accounts), an Anthropic API key and a Channel3 API key.

```bash
npm ci
# create .env with the variables in the table below
npx tsx --env-file=.env scripts/migrate.mts     # create tables (idempotent)
npx tsx --env-file=.env scripts/seed.mts        # demo shops + demo search history (idempotent)
npm run dev                                     # http://localhost:3000
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string (SSL is used for non-localhost hosts) |
| `APP_URL` | Public base URL, `http://localhost:3000` locally. Used for PayPal return/cancel URLs, the webhook and the MCP URL |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app credentials |
| `PAYPAL_WEBHOOK_ID` | Printed by `scripts/register-webhook.mts`. Without it, webhooks are rejected in production and accepted with a warning in dev |
| `SELLER_PAYPAL_EMAIL` | Sandbox business account that receives payments for demo shops |
| `PLATFORM_PAYPAL_EMAIL` | Sandbox account for the Shelf platform |
| `BUYER_PAYPAL_EMAIL`, `BUYER_PAYPAL_PASSWORD` | Sandbox personal account for testing checkout |
| `ANTHROPIC_API_KEY` | Claude API |
| `CHANNEL3_API_KEY` | Channel3 API |
| `DEMO_SHOP_SLUG` | Optional. The shop shown read-only at `/dash/demo` (default `hanul-clay`) |

Webhooks need a public HTTPS URL, so register them against the deployed app:

```bash
APP_URL=https://shelf-ltfn.onrender.com npx tsx --env-file=.env scripts/register-webhook.mts   # prints the PAYPAL_WEBHOOK_ID
```

Locally, the return-URL capture still marks orders paid without webhooks.

To try the import flow against the demo shop locally (private addresses are only allowed outside production):

```bash
cd demo-shop && python3 -m http.server 8080      # then paste http://localhost:8080 into /sell
```

Smoke tests: `scripts/test-paypal.mts`, `scripts/test-mcp.mts` (needs the dev server), `scripts/test-import.mts`,
`scripts/test-channel3.mts`, all run with `npx tsx --env-file=.env scripts/<name>.mts`.

## Deploy on Render

`render.yaml` is a Blueprint with two services:

- `shelf`: Node web service, `npm ci && npm run build`, `npm start`. Secrets are declared with `sync: false`, so
  Render asks for them on first deploy. It points at an existing Postgres through `DATABASE_URL`; the Blueprint
  does not create a database.
- `hanul-clay`: static site served from `demo-shop/`.

After the first deploy: set `APP_URL` to the service URL, run `scripts/migrate.mts` and `scripts/seed.mts` against
the database, run `scripts/register-webhook.mts`, and set `PAYPAL_WEBHOOK_ID`. On the free plan the service sleeps
when idle; a GitHub Actions workflow in `.github/workflows/` pings it every 10 minutes to keep it warm, but the
first request after a pause can still take up to a minute.

## Demo data

`scripts/seed.mts` creates **demo data**: four fictional published shops (a candle maker, a linen weaver, a
coffee roaster and a letterpress studio) and a few dozen agent search-log rows spread over the past 7 days, so
the network and the demand grid aren't empty (the dashboard labels it "Includes sample search history"). Seed
shops are marked `source_url = 'seed'` and paid to the sandbox seller account. **Hanul Clay** and its maker Mina
are fictional too: her store is the Instagram caption in `demo-shop/instagram.txt`, and `demo-shop/` also holds
her link-in-bio page. The demo imports that caption live. `--reset-demo` deletes Hanul Clay, its orders and
recent non-seed searches so the demo can be recorded again.

## Limitations and roadmap

- **Discovery beyond connected assistants.** Today an assistant finds Shelf shops through the Shelf MCP
  connector, plus public pages with JSON-LD and `/llms.txt`. Next: submit Shelf shops to open agent catalogs, and
  publish product feeds to networks like Channel3 so assistants find them without a connector.
- **Platform fees, refunds and seller onboarding.** Payments go straight to the seller's PayPal email and Shelf
  takes no fee. Refunds happen in the seller's PayPal account (Shelf records refund and reversal webhooks). Next: PayPal
  partner onboarding (multiparty) so sellers onboard in a click, Shelf can take a small fee per sale, and, with
  the seller's refund permission, the dashboard can issue refunds itself.
- **Inventory and shipping.** Stock is a simple counter. The agent can set a ship-to address (otherwise it comes
  from the buyer's PayPal profile), but there are no shipping rates, taxes or tracking yet (PayPal's order
  tracking API is a natural next step).
- **One item per order.** Multi-item carts are next.
- **Next for payments**: PayPal vault with a buyer-set budget so repeat buys skip the tap; an approver who isn't
  the shopper (a parent, a manager, a shared budget); payee verification before a shop goes live.
- **Seller auth** is a per-shop secret token (cookie plus header), good enough for a hackathon but not for
  production.
- **Sandbox only.** Going live means production PayPal credentials and seller verification.

## License

[MIT](LICENSE) © 2026 Yunha Lee
