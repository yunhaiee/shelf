# Shelf: Devpost submission

**Project name:** Shelf

**Tagline:** Paste an Instagram caption, get a shop that AI assistants can buy from, with PayPal checkout in
the chat.

**Positioning:** Agentic commerce is being built for sellers with catalogs. Shelf is for the ones who sell from
a caption.

**Links**
- **Demo link: https://shelf-ltfn.onrender.com/try — the whole flow in one page**
- Demo video: `<VIDEO_URL>`
- Hosted app: https://shelf-ltfn.onrender.com
- MCP endpoint (add to Claude Desktop as a custom connector): `https://shelf-ltfn.onrender.com/api/mcp`
- Source: https://github.com/yunhaiee/shelf
- Fictional demo shop (link-in-bio page, used as the fallback import): https://hanul-clay.onrender.com

---

## Inspiration

People have started asking AI assistants to shop for them. When we asked for a handmade mug from a small
studio, the assistant found mugs, some from independent makers, but every one was a link out to another site.
It could point at a small shop. It couldn't buy from it.

Big retailers are getting agent integrations, product feeds and checkout APIs. A one-person pottery studio has
an Instagram caption that ends "DM to order, I'll send a PayPal invoice!". If shopping moves into assistants,
the smallest sellers are the first to disappear from it. We wanted the opposite: a maker should be buyable by an
assistant as easily as they can post a photo.

## Why not Shopify, Etsy in ChatGPT, OpenAI Instant Checkout or PayPal's agentic tools?

Those are real and useful, and they share a starting point: a merchant who already has a catalog or a
storefront on a platform. The agent reads that catalog and checks out against it. Shelf starts one step
earlier, with sellers who have no catalog at all: a caption, a link-in-bio page, a "DM for price". It builds
the catalog for them, gives them an agent-readable page, and makes them buyable over MCP with PayPal, with the
money going straight to their own PayPal account. Nothing here competes with the big platforms; Shelf is for
the sellers they don't reach yet.

## What it does

Shelf has two sides.

**Sellers** paste what they already have: an Instagram caption, a messy list ("speckled mug 28 (the everyday
one, big coffee size) / big oval serving platter… DM for price") or a shop link. Claude extracts the shop and
its products, then writes what agents need: clean descriptions, tags for use case, style, material and gifting,
and structured attributes like dimensions, capacity and care. Channel3 returns market price comps for every
product and suggests a price when the seller didn't list one. The seller reviews it all in an AG Grid editor
where every AI-written cell is highlighted, adds their PayPal email, and presses Publish. They also get an
agent-ready shop page to put in their Instagram bio.

**Shoppers** reach Shelf shops three ways:
1. **An assistant with the Shelf connector.** Shelf is a remote MCP server, added once to Claude Desktop as a
   custom connector.
2. **Any app using the Claude API.** The `/try` page runs Claude through the Claude API's MCP connector,
   pointed at the same Shelf endpoint. No install at all.
3. **The open web.** Every shop has a public page with schema.org Product/Offer JSON-LD, and `/llms.txt` lists
   the MCP endpoint and all published shops.

In the chat:
- `search_products` returns Shelf shops first, buyable in chat, with Channel3 results from the wider market
  below, clearly labeled as link-out only.
- `create_checkout` creates a PayPal order with **the seller as the payee**, and the agent can set the ship-to
  address (a gift goes straight to the recipient). It returns a PayPal approval link.
- The buyer approves on PayPal with one tap. Shelf captures the payment and `check_order` confirms it's paid.

The assistant never pays on its own: the buyer approves every payment on PayPal, and the money goes straight to
the seller's PayPal account. Shelf never holds funds.

**After publishing**, the seller's dashboard shows a live AG Grid of orders that flashes the moment PayPal
confirms a payment, with which assistant made the sale and what the shopper asked for. A second grid shows what
assistants searched for across the network, and Claude turns unmet searches into suggestions (for example,
shoppers keep asking for a ceramic coffee dripper and nobody on Shelf sells one).

## Try it

**Step 0: open https://shelf-ltfn.onrender.com/try.** The whole flow is on one page, nothing to install:
1. Mina's Instagram caption is ready to paste. Press **Import**: Claude and Channel3 build the catalog.
2. Press **Publish**. Your copy of the shop is private to your browser session, so judges don't collide.
3. Ask the in-page Claude for a gift. It's connected to Shelf over MCP and finds your shop.
4. Ask it to buy. Open the PayPal Sandbox link and log in with the sandbox test buyer shown on the page. Tap Pay.
5. Back on `/try`, the seller's orders grid flashes paid.

Render runs on the free plan. A keep-alive pings it every 10 minutes, but the first load can still take up to a
minute. If a step looks stuck, wait and retry once.

**Alternative: Claude Desktop.**
1. Claude Desktop → Settings → Connectors → Add custom connector → URL `https://shelf-ltfn.onrender.com/api/mcp`.
2. Open `https://shelf-ltfn.onrender.com/dash/demo`: Hanul Clay's seller dashboard, read-only (the seller's
   PayPal email and buyer details are hidden). Leave it open.
3. In a new chat: "Use Shelf to find me a speckled mug from a small studio under $40. It's a gift." Starting
   with "Use Shelf" makes sure Claude calls the connector instead of its own web search.
4. Ask Claude to buy it, optionally with a ship-to address and a gift note. Open the PayPal link and log in with
   the same sandbox buyer. Tap Pay.
5. Ask "Did it go through?". `check_order` reports paid.
6. On the dashboard tab, your order row flashes as paid, with "Claude" as the assistant and what you asked.
   Scroll down for the agent demand grid and press "Analyze demand".
7. To try the seller side on its own, open `https://shelf-ltfn.onrender.com/sell`, paste a caption, a product
   list or a shop link, and publish with a sandbox business email. Your shop gets its own private dashboard
   link.

All shops other than those you create are demo data, and Hanul Clay is a fictional studio. Everything runs on
the PayPal Sandbox; no real money moves.

## How we built it

- **Next.js 15** (App Router, TypeScript, Tailwind v4) as one Node web service on **Render**, with **Render
  Postgres** for shops, products, orders, the agent search log and webhook de-duplication. A Render static site
  hosts the fictional shop's link-in-bio page.
- **PayPal** through `@paypal/paypal-server-sdk` (generated by **APIMatic**): Orders v2 create, get and capture,
  with `payee.email_address` set to the seller, an item breakdown, an optional agent-set shipping address with
  `SET_PROVIDED_ADDRESS`, and an experience context (brand "Shelf · {shop}", `PAY_NOW`, return and cancel URLs).
  Every create, capture and refund call carries a `PayPal-Request-Id` idempotency key. The return URL captures
  right away; webhooks are signature-verified with `verify-webhook-signature`, de-duplicated by event id, and
  also drive order status (approved, paid, refunded or failed), so a payment is recorded even if the buyer
  closes the tab.
- **MCP**: the official TypeScript SDK with stateless streamable HTTP (a new server and transport per request,
  JSON responses). Four tools with zod schemas return both readable text and `structuredContent`. Orders record
  which assistant placed them, from MCP `clientInfo` or the User-Agent.
- **Claude**: Sonnet 5.5 for catalog extraction and enrichment, with each AI-written field tracked in
  `ai_fields`. Haiku 5.5 ranks search candidates after a lexical prefilter, writes a one-line "why" per hit and
  drops irrelevant products; it also writes the demand insights. Search falls back to lexical ranking if the
  model times out. The `/try` assistant uses the Claude API's MCP connector, so Claude calls the same public
  Shelf tools a desktop client does.
- **Channel3**: wider-market results in agent search, and low/median/high price comps per imported product.
- **AG Grid Community v36**: the catalog editor (AI-cell highlighting, market range column), the live orders grid
  (row flashing on payment), and the agent demand grid.

## Challenges we ran into

- **Making checkout safe for agents.** An assistant should never be able to spend money on its own. The buyer
  approves every order on PayPal's page, and the MCP instructions tell the model never to claim payment until
  `check_order` says it's paid.
- **Routing money to the seller, not the platform.** Payee routing on Orders v2 sends funds straight to each
  shop's PayPal account without Shelf touching them.
- **Gifts.** Without an address from the agent, PayPal ships to the buyer's own profile, so the gift goes to
  the wrong person. Passing the recipient's address with `SET_PROVIDED_ADDRESS` puts it on the approval page,
  where the buyer checks it before paying.
- **Payment state from two directions.** The return URL and the webhook can both report the same payment, in
  either order. Capture is idempotent (request-id keys), webhook events are de-duplicated, and order status
  never moves backwards from paid or refunded.
- **Refunds when the seller is the payee.** We built platform refunds with Payments v2, then tested one on a
  payee-routed sandbox capture: PayPal answered `PERMISSION_DENIED`. The capture belongs to the seller, so
  refunding it needs the seller's partner permission. Sellers refund from their own PayPal account for now
  (Shelf records the refund webhook), and partner onboarding is the path to refunds from the Shelf dashboard.
- **Search that agents can trust.** Lexical search returned candles for "mug". A small model reranking the
  candidates fixed relevance, with a strict timeout and lexical fallback so search never hangs a conversation.
- **Messy input.** Captions have prices in prose, missing sizes and "DM for price". Tracking which fields the AI
  wrote let us show sellers exactly what to check.

## Accomplishments that we're proud of

- A caption becomes a live shop that Claude can buy from, in about two minutes of the seller's time.
- Payment goes straight to the seller, and the buyer stays in control of every payment with one tap.
- The agent does the paperwork, including the gift's shipping address, and PayPal shows it to the buyer.
- The seller sees agent demand they couldn't see before: which assistant sold their mug, and what shoppers
  asked for that nobody makes yet.
- The whole flow is testable from one link, with no install.

## What we learned

- MCP is a good shape for commerce: a few narrow tools with clear instructions make the model reliable about
  showing approval links and checking status instead of assuming.
- PayPal's approval step is a feature for agentic commerce, not friction. It's the moment the human says yes.
- Agents need different product data than people do. Dimensions, care and capacity decide whether an assistant
  can confidently recommend something.

## What's next for Shelf

- **PayPal vault with a buyer-set budget**, for example "under $50 per order from shops I've bought from", so
  repeat buys skip the tap.
- **The approver doesn't have to be the shopper.** A parent approves a teen's purchase, a manager approves a
  team order, or a shared budget covers a household. The agent prepares the order; whoever holds the money taps
  Pay.
- **Multi-item carts**, across one shop first, then across shops.
- **Payee verification**, so a seller's PayPal email is confirmed before their shop goes live.
- **PayPal partner onboarding** so sellers connect PayPal in one click, Shelf can take a small fee per sale, and,
  with the seller's refund permission, refunds can be issued from the dashboard.
- Shipping rates, taxes and order tracking, plus feeds to product catalogs like Channel3 so assistants find
  Shelf shops without a connector.

## Sponsor tools

| Tool | Where in Shelf |
|---|---|
| **PayPal Orders API v2** | Create orders with seller payee routing, item breakdown, agent-set shipping (`SET_PROVIDED_ADDRESS`) and experience context; approval (`payer-action`) link for the buyer; get status; capture after approval. `PayPal-Request-Id` idempotency keys on create, capture and refund (`lib/checkout.ts`, `lib/paypal.ts`, `app/api/paypal/return`) |
| **PayPal Webhooks** | Signature verification, de-duplication by event id, status updates for approved, completed, refunded, reversed and denied events, no status downgrades (`app/api/paypal/webhook`, `scripts/register-webhook.mts`) |
| **PayPal Sandbox** | All payments: business accounts for sellers, a personal account for the buyer |
| **APIMatic** | `@paypal/paypal-server-sdk`, APIMatic-generated, for every Orders v2 call (`OrdersController`: create, get, capture) with typed enums and SDK retries; one cached OAuth token shared with the two calls the SDK doesn't cover (webhook verify and registration) |
| **Anthropic Claude API** | Sonnet 5.5: extraction and enrichment. Haiku 5.5: search ranking and demand insights. The `/try` assistant via the Claude API MCP connector |
| **Channel3** (`@channel3/sdk`) | Market results in agent search (link-out only), price comps and suggested prices in the catalog editor |
| **AG Grid** (Community v36) | Three grids: catalog editor, live orders grid with row flashing, agent demand grid |
| **Render** | Web service (app, MCP server, PayPal endpoints), static site (the demo shop), Render Postgres, `render.yaml` Blueprint |
| **Model Context Protocol TypeScript SDK** | The Shelf MCP server at `/api/mcp` (streamable HTTP) |
| **Claude Code** | Development assistant used to build the project |

## Built with

`next.js` · `react` · `typescript` · `tailwindcss` · `node.js` · `postgresql` · `render` · `paypal` ·
`paypal-orders-v2` · `paypal-webhooks` · `paypal-server-sdk` · `apimatic` · `ag-grid` · `channel3` ·
`claude` · `anthropic-api` · `model-context-protocol` · `zod`
