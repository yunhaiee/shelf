// Seller import: a shop link or a messy pasted list -> agent-ready draft catalog.
// Steps: fetch + reduce the page (or take the text) -> Claude extracts + enriches (structured output)
// -> code-side guards (prices must appear in the source, images must come from the page) -> Channel3 price comps.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { AIError, MODELS, structured } from "./ai";
import { priceComps } from "./channel3";
import type { DraftProduct, ProductAttributes } from "./types";

export type ImportedShop = { name: string; tagline: string | null; about: string | null; location: string | null };
export type ImportResult = { shop: ImportedShop; products: DraftProduct[] };

/** Real progress of an import, in order: reading the source, the AI pass, then Channel3 comps per product. */
export type ImportStage =
  | { stage: "read" }
  | { stage: "write" }
  | { stage: "prices"; done: number; total: number };

/** Import failure with a seller-readable message and the HTTP status a route should return. */
export class ImportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_INPUT = 30_000;
const MAX_PAGE_TEXT = 40_000;
const MAX_JSONLD = 20_000;
const MAX_IMAGES = 80;
const MAX_PRODUCTS = 40;
const COMPS_CONCURRENCY = 4;
const COMPS_TIMEOUT_MS = 8_000;
const AI_DEADLINE_MS = 45_000;

// ---------- URL safety ----------

function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true;
}

async function assertSafeUrl(u: URL) {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ImportError("Only http(s) links can be imported.");
  if (u.username || u.password) throw new ImportError("Links with credentials can't be imported.");
  if (process.env.NODE_ENV !== "production") return; // local demo shop on localhost must work in dev
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))
    throw new ImportError("That address isn't reachable from Shelf.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new ImportError(`Couldn't find ${host}. Check the link.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new ImportError("That address isn't reachable from Shelf.");
}

/** Fetch with manual redirects (each hop re-checked), 10s timeout and a 2MB cap. */
async function safeFetch(raw: string, accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5") {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportError("That doesn't look like a valid link.");
  }
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let hop = 0; hop < 5; hop++) {
    await assertSafeUrl(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; ShelfImporter/1.0; +https://shelf.app)", accept },
      });
    } catch (err) {
      if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError")
        throw new ImportError("The shop took too long to respond (10s).", 504);
      throw new ImportError(`Couldn't reach ${url.host}.`, 502);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new ImportError(`The shop page returned HTTP ${res.status}.`, 502);
    const body = await readCapped(res);
    return { url, body, contentType: res.headers.get("content-type") ?? "" };
  }
  throw new ImportError("Too many redirects.", 502);
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new ImportError("That page is too large to import (over 2MB).", 413);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ImportError("That page is too large to import (over 2MB).", 413);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

// ---------- HTML reduction (no DOM dependency) ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", middot: "·", copy: "©", deg: "°", times: "×" };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim() : null;
}

function absolutize(src: string | null, base: URL): string | null {
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("javascript:")) return null;
  try {
    const u = new URL(src, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

type PageImage = { url: string; alt: string };

export function reduceHtml(html: string, base: URL) {
  const jsonLd: string[] = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    try {
      jsonLd.push(JSON.stringify(JSON.parse(raw)));
    } catch {
      jsonLd.push(raw.replace(/\s+/g, " "));
    }
  }

  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    const content = attr(m[0], "content");
    if (content && /^(og:|twitter:|description$|product:)/.test(key)) meta[key] = content;
  }
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");

  const images: PageImage[] = [];
  const seen = new Set<string>();
  const addImg = (src: string | null, alt: string) => {
    const abs = absolutize(src, base);
    if (!abs || seen.has(abs) || images.length >= MAX_IMAGES) return;
    if (/(sprite|pixel|tracking|spacer|logo-?icon|favicon)/i.test(abs)) return;
    seen.add(abs);
    images.push({ url: abs, alt: alt.slice(0, 160) });
  };
  for (const key of ["og:image", "og:image:url", "twitter:image"]) if (meta[key]) addImg(meta[key], "og:image");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    const fromSet = srcset?.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop() ?? null;
    addImg(attr(tag, "src") ?? attr(tag, "data-src") ?? fromSet, attr(tag, "alt") ?? attr(tag, "title") ?? "");
  }

  // Visible text, keeping block structure as newlines and marking image positions so the model can pair them.
  const imgPos = new Map(images.map((im, i) => [im.url, i]));
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = absolutize(attr(tag, "src") ?? attr(tag, "data-src"), base);
        const i = src != null ? imgPos.get(src) : undefined;
        return i != null ? ` [image #${i}] ` : " ";
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|figure|figcaption|dd|dt|ul|ol|table|main|aside|nav|blockquote)>/gi, "\n")
      .replace(/<(li)\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, meta, jsonLd, images, text };
}

/** Shopify stores expose a public catalog feed; use it when the page is a Shopify storefront. */
async function tryShopifyFeed(base: URL, html: string): Promise<string | null> {
  if (!/cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html)) return null;
  try {
    const { body } = await safeFetch(new URL("/products.json?limit=50", base).href, "application/json");
    const data = JSON.parse(body) as { products?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.products) || data.products.length === 0) return null;
    const lines = data.products.slice(0, MAX_PRODUCTS).map((p) => {
      const variants = (p.variants as Array<{ price?: string; available?: boolean }> | undefined) ?? [];
      const images = (p.images as Array<{ src?: string }> | undefined) ?? [];
      const bodyText = decodeEntities(String(p.body_html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500);
      return JSON.stringify({
        title: p.title,
        price: variants[0]?.price ?? null,
        available: variants.some((v) => v.available !== false),
        product_type: p.product_type || undefined,
        tags: p.tags || undefined,
        image: images[0]?.src ?? null,
        description: bodyText || undefined,
      });
    });
    return lines.join("\n");
  } catch {
    return null;
  }
}

// ---------- AI extraction + enrichment ----------

const ExtractSchema = z.object({
  shop: z.object({
    name: z.string(),
    tagline: z.string().nullable(),
    about: z.string().nullable(),
    location: z.string().nullable(),
  }),
  products: z.array(
    z.object({
      title: z.string(),
      listed_price: z.number().nullable(),
      price_text: z.string().nullable(),
      currency: z.string(),
      image_index: z.number().int().nullable(),
      seller_description: z.string().nullable(),
      description: z.string(),
      description_origin: z.enum(["seller_verbatim", "lightly_cleaned", "ai_written"]),
      tags: z.array(z.string()),
      attributes: z.object({
        material: z.string().nullable(),
        color: z.string().nullable(),
        dimensions: z.string().nullable(),
        capacity: z.string().nullable(),
        care: z.string().nullable(),
        handmade: z.boolean().nullable(),
      }),
      attributes_stated_by_seller: z.array(z.enum(["material", "color", "dimensions", "capacity", "care", "handmade"])),
      availability: z.enum(["in_stock", "sold_out", "one_of_a_kind", "limited", "unknown"]),
      quantity_hint: z.number().int().nullable(),
    }),
  ),
});
type Extracted = z.infer<typeof ExtractSchema>;

const SYSTEM = `You turn a small independent shop's catalog into clean, agent-ready product data. Sources are messy: a scraped web page, an Instagram caption, a pasted list.

Extract
- shop: the shop/brand name (from the source; if none is given, a short neutral name from what they sell), a one-line tagline in their voice (null if nothing to go on), about (1–2 sentences, from the source only), location (only if stated, else null).
- products: every distinct product for sale (max ${MAX_PRODUCTS}). Ignore navigation, shipping/policy text, blog posts, reviews, and "sold" archive galleries unless they're clearly for sale. Merge duplicates. Title: clean, human, title-case product name without emojis, hype or prices ("Speckled Mug, 12 oz" not "speckled mug 12oz $28 ✿").

PRICES ARE SACRED
- listed_price = the exact number the seller wrote for that product (e.g. "$28" → 28, "– 24" → 24, "18" at the end of a line in a price list → 18). Copy it; never round, convert, estimate, or infer.
- price_text = the exact characters you read it from (e.g. "$28", "24").
- If no price is written for that product ("price dm me", "ask", "inquire", missing) → listed_price = null and price_text = null. Never guess a price; a market estimate is added later by other code.
- Sizes and capacities (12oz, 8") are never prices.
- currency: ISO code; "USD" unless the source clearly shows another currency.

Images
- image_index = the number N of the [image #N] from the provided image list that shows this product (use alt text, filename and position in the page text). null if unsure. Never invent URLs.

Enrichment (this is what AI shopping assistants read)
- seller_description: the seller's own words about this product, verbatim, or null if none.
- description: 2–3 clear sentences a shopping assistant can quote: what it is, what it's made of, size/capacity if known, what it's good for. Keep the seller's voice and every fact they gave; add nothing that is not supported by the source or plainly implied by the product type. Never mention price, "DM for price", discounts, shipping times or how to contact the seller in the description. description_origin = "seller_verbatim" if you used their text unchanged, "lightly_cleaned" if you only fixed typos/formatting, "ai_written" if you wrote or substantially expanded it.
- tags: 6–10 short lowercase search tags covering product type, use case, style, material, color, and gift suitability (e.g. "coffee mug", "speckled", "stoneware", "handmade", "gift for coffee lovers").
- attributes: material, color, dimensions, capacity, care, handmade.
  - dimensions and capacity: ONLY if stated in the source; otherwise null. Never invent measurements.
  - material / color / handmade: from the source, or a confident inference from the product type and shop (a pottery studio's mug → "stoneware" or "ceramic"; a small maker → handmade true). null if not confident.
  - care: from the source, or a conservative generic instruction for that material (e.g. "Hand wash recommended") — never claim dishwasher/microwave/food safe unless stated.
  - attributes_stated_by_seller: list ONLY the attribute keys whose value came directly from the seller's text. Everything else you filled is treated as an AI suggestion the seller will review.
- availability / quantity_hint: "sold out" → sold_out; "one of a kind"/"only one" → one_of_a_kind; "only 3 left"/"limited" → limited with quantity_hint 3; otherwise in_stock or unknown, quantity_hint null.`;

function buildPrompt(src: { kind: "url" | "text"; url?: string; title?: string; meta?: Record<string, string>; jsonLd?: string[]; images?: PageImage[]; text: string; feed?: string | null }) {
  const parts: string[] = [];
  if (src.kind === "url") {
    parts.push(`Source: web page ${src.url}`);
    if (src.title) parts.push(`<title>${src.title}</title>`);
    const metaLines = Object.entries(src.meta ?? {}).map(([k, v]) => `${k}: ${v}`);
    if (metaLines.length) parts.push(`<meta>\n${metaLines.join("\n")}\n</meta>`);
    if (src.jsonLd?.length) parts.push(`<json_ld>\n${src.jsonLd.join("\n").slice(0, MAX_JSONLD)}\n</json_ld>`);
    if (src.feed) parts.push(`<store_catalog_feed>\n${src.feed}\n</store_catalog_feed>`);
    if (src.images?.length)
      parts.push(`<images>\n${src.images.map((im, i) => `[image #${i}] ${im.url}${im.alt ? ` — alt: ${im.alt}` : ""}`).join("\n")}\n</images>`);
    parts.push(`<page_text>\n${src.text.slice(0, MAX_PAGE_TEXT)}\n</page_text>`);
  } else {
    parts.push(`Source: text pasted by the seller (e.g. an Instagram caption or a quick list).`);
    parts.push(`<pasted_text>\n${src.text}\n</pasted_text>`);
  }
  parts.push("Extract the shop and its products as specified.");
  return parts.join("\n\n");
}

/** All numbers written in the source, normalized ("28", "28.00", "1,200" → 28, 28, 1200). */
function sourceNumbers(source: string): Set<number> {
  const out = new Set<number>();
  for (const m of source.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?/g)) {
    const raw = m[0];
    const n = /,\d{3}/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
    if (Number.isFinite(n)) out.add(Math.round(n * 100) / 100);
  }
  return out;
}

const ATTR_KEYS = ["material", "color", "dimensions", "capacity", "care", "handmade"] as const;

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.toLowerCase().replace(/^#/, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.slice(0, 10);
}

function toDraft(p: Extracted["products"][number], images: PageImage[], nums: Set<number>): DraftProduct {
  const ai: string[] = [];

  // Price guard: only accept a price that literally appears in the source.
  let price: number | null = null;
  if (p.listed_price != null && p.listed_price > 0) {
    const rounded = Math.round(p.listed_price * 100) / 100;
    if (nums.has(rounded)) price = rounded;
  }

  const desc = p.description.trim() || p.seller_description?.trim() || null;
  if (desc && p.description_origin === "ai_written") ai.push("description");

  const attributes: ProductAttributes = {};
  const stated = new Set(p.attributes_stated_by_seller);
  for (const k of ATTR_KEYS) {
    const v = p.attributes[k];
    if (v == null || (typeof v === "string" && !v.trim())) continue;
    (attributes as Record<string, string | boolean>)[k] = typeof v === "string" ? v.trim() : v;
    if (!stated.has(k)) ai.push(`attributes.${k}`);
  }

  const tags = cleanTags(p.tags);
  if (tags.length) ai.push("tags");

  const img = p.image_index != null && p.image_index >= 0 && p.image_index < images.length ? images[p.image_index].url : null;

  const stock =
    p.availability === "sold_out" ? 0 : p.availability === "one_of_a_kind" ? 1 : p.quantity_hint != null && p.quantity_hint > 0 ? Math.min(p.quantity_hint, 999) : 10;

  return {
    title: p.title.trim().slice(0, 200),
    description: desc,
    price,
    currency: /^[A-Z]{3}$/.test(p.currency) ? p.currency : "USD",
    image_url: img,
    tags,
    attributes,
    ai_fields: ai,
    market_low: null,
    market_median: null,
    market_high: null,
    stock,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Channel3 comps for every product (concurrency-limited); `onDone` fires as each one finishes. */
async function addMarketComps(products: DraftProduct[], onDone?: () => void): Promise<DraftProduct[]> {
  return mapLimit(products, COMPS_CONCURRENCY, async (d) => {
    try {
      return await compsFor(d);
    } finally {
      onDone?.();
    }
  });
}

/** Channel3 market range for one product; fills a missing price with the rounded median (flagged as AI). */
async function compsFor(d: DraftProduct): Promise<DraftProduct> {
  const q = [d.title, typeof d.attributes.material === "string" ? d.attributes.material : ""].filter(Boolean).join(" ");
  const comps = await withTimeout(priceComps(q), COMPS_TIMEOUT_MS).catch((err) => {
    console.warn("[import] Channel3 comps failed for", JSON.stringify(q), (err as Error)?.message);
    return null;
  });
  if (!comps) return d;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const next: DraftProduct = { ...d, market_low: r2(comps.low), market_median: r2(comps.median), market_high: r2(comps.high) };
  if (next.price == null && comps.median > 0) {
    next.price = Math.max(1, Math.round(comps.median));
    next.ai_fields = [...next.ai_fields, "price"];
  }
  return next;
}

export async function importCatalog(
  input: { url?: string; text?: string },
  opts: { onStage?: (s: ImportStage) => void } = {},
): Promise<ImportResult> {
  const url = input.url?.trim();
  const text = input.text?.trim();
  if (!url && !text) throw new ImportError("Paste a shop link or a product list.");
  const stage = (s: ImportStage) => {
    try {
      opts.onStage?.(s);
    } catch {
      /* progress reporting must never break the import */
    }
  };
  stage({ stage: "read" });

  let prompt: string;
  let images: PageImage[] = [];
  let sourceForPrices: string;

  if (url) {
    const page = await safeFetch(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    const ct = page.contentType.toLowerCase();
    if (ct && !/(text\/html|xhtml|text\/plain|application\/json|application\/ld\+json)/.test(ct))
      throw new ImportError("That link isn't a web page we can read (try the shop's homepage or product page).", 415);
    if (/text\/plain|json/.test(ct)) {
      const body = page.body.slice(0, MAX_PAGE_TEXT);
      prompt = buildPrompt({ kind: "url", url: page.url.href, text: body });
      sourceForPrices = body;
    } else {
      const reduced = reduceHtml(page.body, page.url);
      const feed = await tryShopifyFeed(page.url, page.body);
      if (reduced.text.length < 40 && !reduced.jsonLd.length && !feed)
        throw new ImportError("That page has almost no readable text (it may need JavaScript). Try pasting your product list instead.", 422);
      images = reduced.images;
      prompt = buildPrompt({ kind: "url", url: page.url.href, ...reduced, feed });
      sourceForPrices = [reduced.title, JSON.stringify(reduced.meta), reduced.jsonLd.join("\n"), feed ?? "", reduced.text].join("\n");
    }
  } else {
    if (text!.length > MAX_TEXT_INPUT) throw new ImportError(`That's a lot of text — paste up to ${MAX_TEXT_INPUT.toLocaleString()} characters at a time.`, 413);
    prompt = buildPrompt({ kind: "text", text: text! });
    sourceForPrices = text!;
  }

  stage({ stage: "write" });
  const extracted = await structured({
    model: MODELS.extract,
    what: "reading your catalog",
    schema: ExtractSchema,
    system: SYSTEM,
    user: prompt,
    maxTokens: 16_000,
    timeoutMs: AI_DEADLINE_MS,
    signal: AbortSignal.timeout(AI_DEADLINE_MS + 2_000),
    effort: "low",
  });

  const nums = sourceNumbers(sourceForPrices);
  const drafts = extracted.products
    .filter((p) => p.title.trim())
    .slice(0, MAX_PRODUCTS)
    .map((p) => toDraft(p, images, nums));
  if (drafts.length === 0) throw new ImportError("We couldn't find any products there. Try pasting your product list as text.", 422);

  let done = 0;
  stage({ stage: "prices", done, total: drafts.length });
  const products = await addMarketComps(drafts, () => stage({ stage: "prices", done: ++done, total: drafts.length }));
  const s = extracted.shop;
  return {
    shop: {
      name: s.name.trim().slice(0, 120) || "My shop",
      tagline: s.tagline?.trim() || null,
      about: s.about?.trim() || null,
      location: s.location?.trim() || null,
    },
    products,
  };
}

export { AIError };

// ---------- input validation shared by the seller API routes ----------

const money = z.coerce.number().finite().min(0).max(100_000).transform((n) => Math.round(n * 100) / 100);
const attributesSchema = z
  .record(z.string().max(60), z.union([z.string().max(500), z.boolean(), z.null()]))
  .transform((r) => {
    const out: ProductAttributes = {};
    for (const [k, v] of Object.entries(r)) if (v != null && v !== "") out[k] = typeof v === "string" ? v.trim() : v;
    return out;
  });
const tagsSchema = z.array(z.string().max(60)).max(30).transform(cleanTags);
const imageUrlSchema = z
  .string()
  .max(4000)
  .nullable()
  .transform((s) => (s && /^(https?:\/\/|data:image\/)/i.test(s.trim()) ? s.trim() : null));

/** A DraftProduct as sent by the seller UI (lenient defaults, strict types). */
export const draftProductSchema = z.object({
  title: z.string().trim().min(1, "Every product needs a title.").max(200),
  description: z.string().max(4000).nullable().optional().transform((s) => s?.trim() || null),
  price: money.nullable().optional().transform((n) => n ?? null),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional().transform((c) => (c ?? "USD").toUpperCase()),
  image_url: imageUrlSchema.optional().transform((s) => s ?? null),
  tags: tagsSchema.optional().transform((t) => t ?? []),
  attributes: attributesSchema.optional().transform((a) => a ?? {}),
  ai_fields: z.array(z.string().max(60)).max(40).optional().transform((a) => [...new Set(a ?? [])]),
  market_low: money.nullable().optional().transform((n) => n ?? null),
  market_median: money.nullable().optional().transform((n) => n ?? null),
  market_high: money.nullable().optional().transform((n) => n ?? null),
  stock: z.coerce.number().int().min(0).max(100_000).optional().transform((n) => n ?? 10),
});

/** Partial product edit from the catalog grid. ai_fields is managed server-side. */
export const productPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).nullable().transform((s) => s?.trim() || null),
    price: money,
    currency: z.string().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()),
    image_url: imageUrlSchema,
    tags: tagsSchema,
    attributes: attributesSchema,
    stock: z.coerce.number().int().min(0).max(100_000),
  })
  .partial();
