// Shared domain types. Every module codes against these; change only with care.
// Postgres numeric columns come back as strings from `pg`; lib/repo.ts converts them to numbers.

export type ShopStatus = "draft" | "published";
export type OrderStatus = "created" | "approved" | "paid" | "refunded" | "failed" | "cancelled";

export type Shop = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  about: string | null;
  location: string | null;
  paypal_email: string | null;
  source_url: string | null;
  status: ShopStatus;
  created_at: string;
  published_at: string | null;
  edit_token?: string; // only present on server-side reads that need it; never send to agents
};

export type ProductAttributes = {
  material?: string;
  color?: string;
  dimensions?: string;
  capacity?: string;
  care?: string;
  handmade?: boolean;
  [k: string]: string | boolean | undefined;
};

export type Product = {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  tags: string[];
  attributes: ProductAttributes;
  ai_fields: string[];
  market_low: number | null;
  market_median: number | null;
  market_high: number | null;
  stock: number;
  created_at: string;
  updated_at: string;
};

/** Product as the AI extracts it, before it has an id / shop. */
export type DraftProduct = {
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  image_url: string | null;
  tags: string[];
  attributes: ProductAttributes;
  ai_fields: string[];
  market_low: number | null;
  market_median: number | null;
  market_high: number | null;
  stock: number;
};

export type Order = {
  id: string;
  paypal_order_id: string | null;
  product_id: string;
  shop_id: string;
  qty: number;
  amount: number;
  currency: string;
  status: OrderStatus;
  client_name: string | null;
  query: string | null;
  gift_note: string | null;
  ship_to_name: string | null;
  capture_id: string | null;
  payer_email: string | null;
  created_at: string;
  paid_at: string | null;
};

export type SearchLog = {
  id: string;
  query: string;
  max_price: number | null;
  client_name: string | null;
  shelf_hit_count: number;
  market_hit_count: number;
  top_product_id: string | null;
  created_at: string;
};

/** One row in an agent-facing search result (MCP search_products). */
export type SearchHit =
  | {
      source: "shelf";
      product_id: string;
      title: string;
      shop: string;
      shop_slug: string;
      price: number;
      currency: string;
      image_url: string | null;
      why: string; // short reason it matches, for the agent
      buyable_in_chat: true;
      published_at: string | null;
    }
  | {
      source: "market"; // Channel3
      title: string;
      merchant: string | null;
      price: number | null;
      currency: string;
      image_url: string | null;
      buy_url: string | null;
      buyable_in_chat: false;
    };
