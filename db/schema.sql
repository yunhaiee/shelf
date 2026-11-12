-- Shelf schema. Idempotent: safe to re-run (scripts/migrate.mts).
create extension if not exists pgcrypto;

create table if not exists shops (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  tagline       text,
  about         text,
  location      text,
  paypal_email  text,                 -- seller's own PayPal account: Orders v2 payee
  source_url    text,                 -- link the catalog was imported from
  status        text not null default 'draft' check (status in ('draft','published')),
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  title         text not null,
  description   text,
  price         numeric(10,2) not null check (price >= 0),
  currency      text not null default 'USD',
  image_url     text,
  tags          text[] not null default '{}',     -- agent-readable tags: "gift", "speckled", "stoneware"
  attributes    jsonb  not null default '{}',     -- {material, dimensions, capacity, care, color, handmade, ...}
  ai_fields     text[] not null default '{}',     -- which fields the AI filled (highlighted in AG Grid)
  market_low    numeric(10,2),                    -- Channel3 price comps
  market_median numeric(10,2),
  market_high   numeric(10,2),
  stock         integer not null default 10,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists products_shop_idx on products(shop_id);

create table if not exists searches (
  id                uuid primary key default gen_random_uuid(),
  query             text not null,
  max_price         numeric(10,2),
  client_name       text,               -- MCP clientInfo.name, e.g. "claude-ai"
  shelf_hit_count   integer not null default 0,
  market_hit_count  integer not null default 0,
  top_product_id    uuid references products(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists searches_created_idx on searches(created_at desc);

create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  paypal_order_id  text unique,
  product_id       uuid not null references products(id) on delete restrict,
  shop_id          uuid not null references shops(id) on delete cascade,
  qty              integer not null default 1 check (qty > 0),
  amount           numeric(10,2) not null,
  currency         text not null default 'USD',
  status           text not null default 'created'
                   check (status in ('created','approved','paid','refunded','failed','cancelled')),
  client_name      text,                -- which assistant placed it
  query            text,                -- what the shopper asked for
  gift_note        text,
  ship_to_name     text,
  capture_id       text,
  payer_email      text,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);
create index if not exists orders_shop_idx on orders(shop_id, created_at desc);

create table if not exists webhook_events (
  id           text primary key,          -- PayPal event id (dedupe)
  event_type   text not null,
  resource_id  text,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);

-- Seller auth for the hackathon: a secret per shop, returned once at creation,
-- required (x-shop-token header or shelf_token_<slug> cookie) for edits and the private dashboard.
alter table shops add column if not exists edit_token text not null default encode(gen_random_bytes(18), 'hex');
