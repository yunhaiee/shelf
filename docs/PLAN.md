# Shelf — build plan

Deadline: 2026-11-12 12:00 PST. Target: submitted by ~09:00, rest is buffer.

## Pitch
**Shelf makes any small shop buyable by AI assistants in two minutes.**
People now ask AI assistants to shop for them. Assistants can *find* independent makers, but only as a link
out of the chat: they can't buy. A seller pastes their shop link or a messy product list; Shelf's AI turns it
into an agent-ready catalog (Channel3 suggests prices), and on Publish it is instantly searchable and buyable
inside any assistant connected to Shelf. Checkout runs through PayPal with the buyer approving every payment,
and the money goes straight to the seller's own PayPal account.
Shoppers connect Shelf once. Sellers never ask anyone to install anything.

## Architecture
```
 SELLER (browser)                          SHOPPER (Claude Desktop, Shelf connector added once)
   │ paste link / list                        │ "speckled mug from a small studio, under $40"
   ▼                                          ▼
 ┌──────────────────── Shelf: one Next.js service on Render ───────────────────────────┐
 │ /sell      import ─► Claude: extract + enrich ─► Channel3 price comps                │
 │            AG Grid catalog editor (AI cells highlighted) ─► Publish                   │
 │ /api/mcp   MCP server (streamable HTTP)                                               │
 │            search_products ─► Shelf shops (Postgres)  +  Channel3 market (links out)  │
 │            get_product · create_checkout · check_order                               │
 │            every query logged ─► demand insights                                      │
 │ /api/paypal/return   capture order ─► "Paid. Back to Claude."                         │
 │ /api/paypal/webhook  verify ─► dedupe ─► paid / refunded / failed (backup path)       │
 │ /dash      AG Grid: Orders (live, which assistant) · Agent demand (unmet searches)    │
 │ /s/[shop]  public page + schema.org JSON-LD + /llms.txt (open-web discovery)          │
 └──────┬──────────────────────┬──────────────────────────┬────────────────────────────┘
        ▼                      ▼                          ▼
  Render Postgres     PayPal Orders v2 (sandbox)     Claude API (Sonnet 5.5 / Haiku 5.5)
                      payee = seller · approve link   Channel3 API
                      capture · webhooks
```

## Checkout flow
```
Claude ─create_checkout─► Shelf ─POST /v2/checkout/orders (payee=seller)─► PayPal
   ◄── approve link ─────────┘
Buyer clicks link ─► PayPal sandbox login + Approve ─► /api/paypal/return ─► capture
PayPal ─PAYMENT.CAPTURE.COMPLETED webhook─► Shelf ─► order=paid ─► seller dashboard flashes
Claude ─check_order─► "Paid. Hanul Clay ships in 2 days."
```

## Data model (Postgres)
- shops(id, slug, name, about, paypal_email, published_at)
- products(id, shop_id, title, description, price, currency, image_url, tags[], attributes jsonb,
  ai_fields text[], market_low/median/high, stock, search tsvector)
- searches(id, query, max_price, client_name, shelf_hits, created_at)
- orders(id, paypal_order_id, product_id, shop_id, qty, amount, status, client_name, query, created_at, paid_at)

## Sponsor + PayPal usage (what judges will see)
- PayPal: Orders v2 create/capture with payee routing, approval links, webhooks (incl. refund/reversal events), status tool,
  via `@paypal/paypal-server-sdk` (APIMatic-generated).
- AG Grid: catalog editor, live orders grid (flashing rows), agent demand grid.
- Channel3: market results in agent search; price comps in the catalog editor.
- APIMatic: PayPal server SDK + context plugin used while building (documented in README).
- Render: web service + Postgres + webhook endpoint = hosted demo URL.
- AI: extraction from link/text, enrichment for agents, search ranking, demand insights.

## Phases (PST)
| # | Time | Phase | Done when |
|---|------|-------|-----------|
| 1 | 22:45–23:15 | DB schema + seed shop | tables exist on Render Postgres |
| 2 | 23:15–00:15 | PayPal checkout round trip | script: create → approve → capture → webhook |
| 3 | 00:15–01:30 | MCP server + 4 tools | Claude Code can search + buy locally |
| 4 | 01:30–02:15 | Deploy to Render + Claude Desktop connector | **gate:** Desktop buys from deployed Shelf |
| 5 | 02:15–04:15 | Seller import + AG Grid editor + publish | link → catalog → live in search |
| 6 | 04:15–05:15 | Dashboard grids + live webhook + insights | row flashes on payment |
| 7 | 05:15–06:15 | Demo shop site, seed data, UI polish | demo script runs clean twice |
| 8 | 06:15–09:00 | README, LICENSE, submission text, video | Devpost submitted |

## Cut list (if behind)
Refund tool → open-web JSON-LD/llms.txt → photo import → demand insights AI (keep the raw grid).
Never cut: PayPal round trip, MCP in Claude Desktop, AG Grid editor + orders grid, Channel3 in search.
