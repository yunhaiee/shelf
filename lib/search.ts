// Agent search: independent Shelf shops (buyable in chat) + the wider market via Channel3 (link-out only).
// Shelf ranking = cheap lexical prefilter -> Claude Haiku relevance ranking, with a lexical fallback.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { searchMarket, type MarketItem } from "./channel3";
import { listSearchableProducts, logSearch, type SearchableProduct } from "./repo";
import type { SearchHit } from "./types";

export type ShelfHit = Extract<SearchHit, { source: "shelf" }>;
export type MarketHit = Extract<SearchHit, { source: "market" }>;

const RANK_MODEL = "claude-haiku-5-5";
const RANK_TIMEOUT_MS = 6_000;
const MARKET_TIMEOUT_MS = 8_000;
const MAX_CANDIDATES = 30;
const DEFAULT_LIMIT = 5;
const MARKET_LIMIT = 5;

// ---------- query parsing ----------

const PRICE_CAP_RE =
  /\b(?:under|below|less than|cheaper than|no more than|max(?:imum)?|up to|at most|within|<=?)\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks)?/i;

/** "speckled mug under $40" -> 40. Returns null when the query names no price cap. */
export function parsePriceCap(query: string): number | null {
  const m = query.match(PRICE_CAP_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Removes the price phrase so it doesn't pollute text matching ("under $40" is a filter, not a keyword). */
export function stripPriceCap(query: string): string {
  return query.replace(PRICE_CAP_RE, " ").replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set(
  ("a an and any are as at be by for from get i in is it me my of on or our please some something " +
    "that the this to with want need looking find buy shop small studio independent maker made " +
    "would like nice good one ones who what which").split(" "),
);

// Small synonym groups so "cup" finds "mug" and "pottery" finds "stoneware" without an AI call.
const SYNONYMS: string[][] = [
  ["mug", "cup", "tumbler"],
  ["ceramic", "ceramics", "stoneware", "pottery", "porcelain", "clay", "earthenware"],
  ["gift", "present", "gifting"],
  ["bowl", "dish"],
  ["vase", "planter"],
  ["candle", "candles", "wax"],
  ["linen", "textile", "cloth", "fabric"],
  ["card", "cards", "stationery", "letterpress"],
  ["coffee", "espresso", "beans", "roast"],
  ["handmade", "handcrafted", "artisan", "handthrown"],
];
const SYN_INDEX = new Map<string, string[]>();
for (const group of SYNONYMS) for (const w of group) SYN_INDEX.set(stem(w), group);

function stem(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(stem);
}

function queryTerms(query: string): string[] {
  const terms = tokenize(stripPriceCap(query)).filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  return [...new Set(terms)];
}

// ---------- lexical scoring ----------

type Fields = { title: Set<string>; tags: Set<string>; attrs: Set<string>; shop: Set<string>; desc: Set<string> };
const WEIGHTS: Record<keyof Fields, number> = { title: 3, tags: 2, attrs: 1.5, shop: 1, desc: 1 };

function fieldsOf(p: SearchableProduct): Fields {
  const attrText = Object.entries(p.attributes ?? {})
    .map(([k, v]) => (typeof v === "boolean" ? (v ? k : "") : `${v ?? ""}`))
    .join(" ");
  return {
    title: new Set(tokenize(p.title)),
    tags: new Set(p.tags.flatMap(tokenize)),
    attrs: new Set(tokenize(attrText)),
    shop: new Set(tokenize(`${p.shop_name} ${p.shop_location ?? ""}`)),
    desc: new Set(tokenize(p.description ?? "")),
  };
}

function termMatches(term: string, words: Set<string>): number {
  if (words.has(term)) return 1;
  const group = SYN_INDEX.get(term);
  if (group?.some((s) => words.has(stem(s)))) return 0.7;
  if (term.length >= 4) for (const w of words) if (w.length >= 4 && (w.startsWith(term) || term.startsWith(w))) return 0.6;
  return 0;
}

type Scored = { p: SearchableProduct; score: number; strong: boolean; matched: string[] };

function lexicalScore(p: SearchableProduct, terms: string[]): Scored {
  const f = fieldsOf(p);
  let score = 0;
  let strong = false; // matched a term in title or tags (not just the description/shop)
  const matched: string[] = [];
  for (const t of terms) {
    let best = 0;
    for (const k of Object.keys(WEIGHTS) as (keyof Fields)[]) {
      const m = termMatches(t, f[k]) * WEIGHTS[k];
      if (m > best) best = m;
      if (m > 0 && (k === "title" || k === "tags")) strong = true;
    }
    if (best > 0) matched.push(t);
    score += best;
  }
  return { p, score, strong, matched };
}

// ---------- Claude ranking ----------

let anthropic: Anthropic | null = null;
function getAnthropic() {
  anthropic ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  return anthropic;
}

const RankSchema = z.object({
  results: z.array(
    z.object({
      ref: z.string().describe("The candidate's ref, exactly as given, e.g. p3"),
      fit: z
        .enum(["same_type", "substitute", "different_type"])
        .describe(
          "same_type = the kind of product asked for; substitute = serves the same use (a cup for a mug); different_type = another kind of product (a bowl for a mug)",
        ),
      why: z.string().describe("Why it fits the shopper's request, max 15 words, concrete (material, style, price, use)"),
    }),
  ),
});

const RANK_SYSTEM = `You rank products from independent shops for an AI shopping assistant.
Given a shopper's request and candidate products, return ONLY the products that genuinely match what the shopper asked for, best match first.
- Product type comes first. When the request names a kind of product (mug, bowl, candle, napkins...), only that kind or a direct equivalent (a cup for a mug) can match. A mug request must not return candles, cards or bowls, even if they are "handmade", "gifts" or share a material.
- Grade each result's fit honestly. When the request names a product type, leave out anything you would grade "different_type". For broad requests ("a gift for a coffee lover") every plausible product counts as same_type.
- Respect explicit constraints (price cap, color, material, size, occasion). Candidates over the price cap were already removed.
- If the request is broad (e.g. "a gift for a coffee lover"), include every product that plausibly serves it.
- Return an empty list when nothing fits. Never invent refs.
- "why" is at most 15 words, factual, written for the shopper (e.g. "Speckled stoneware mug, 12 oz, hand-thrown; giftable at $28").`;

function candidateLine(ref: string, p: SearchableProduct) {
  const attrs = Object.entries(p.attributes ?? {})
    .filter(([, v]) => v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${k}: ${v === true ? "yes" : v}`)
    .join("; ");
  const desc = (p.description ?? "").replace(/\s+/g, " ").slice(0, 220);
  return `${ref} | ${p.title} | ${p.currency} ${p.price.toFixed(2)} | shop: ${p.shop_name}${
    p.shop_location ? ` (${p.shop_location})` : ""
  } | tags: ${p.tags.slice(0, 10).join(", ")}${attrs ? ` | ${attrs}` : ""}${desc ? ` | ${desc}` : ""}`;
}

async function rankWithClaude(
  query: string,
  maxPrice: number | null,
  candidates: SearchableProduct[],
  limit: number,
): Promise<{ p: SearchableProduct; why: string }[]> {
  const byRef = new Map(candidates.map((p, i) => [`p${i + 1}`, p]));
  const list = candidates.map((p, i) => candidateLine(`p${i + 1}`, p)).join("\n");
  const res = await getAnthropic().messages.parse(
    {
      model: RANK_MODEL,
      max_tokens: 2000,
      thinking: { type: "disabled" }, // latency-sensitive ranking; structured output keeps the shape exact
      output_config: { effort: "low", format: zodOutputFormat(RankSchema) },
      system: RANK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Shopper request: ${JSON.stringify(query)}${
            maxPrice != null ? `\nPrice cap: ${maxPrice}` : ""
          }\nReturn at most ${limit} products.\n\nCandidates:\n${list}`,
        },
      ],
    },
    { timeout: RANK_TIMEOUT_MS, maxRetries: 0 },
  );
  if (res.stop_reason === "refusal") throw new Error("ranking refused");
  const parsed = res.parsed_output;
  if (!parsed) throw new Error(`ranking returned no parseable output (stop_reason=${res.stop_reason})`);
  const seen = new Set<string>();
  const out: { p: SearchableProduct; why: string }[] = [];
  // Same-type matches before substitutes (stable, so the model's order holds within a grade).
  const ordered = [...parsed.results].sort((a, b) => Number(a.fit !== "same_type") - Number(b.fit !== "same_type"));
  for (const r of ordered) {
    const p = byRef.get(r.ref.trim());
    if (!p || seen.has(p.id)) continue; // ignore hallucinated / duplicate refs
    if (r.fit === "different_type") continue; // the model sometimes lists "a bowl, not a mug"; never show it
    seen.add(p.id);
    out.push({ p, why: clampWords(r.why, 15) });
    if (out.length >= limit) break;
  }
  return out;
}

function clampWords(s: string, n: number) {
  const words = s.replace(/\s+/g, " ").trim().split(" ");
  return words.length <= n ? words.join(" ") : words.slice(0, n).join(" ") + "…";
}

function lexicalWhy(s: Scored) {
  const t = s.p.attributes?.material ? `${s.p.attributes.material}` : s.p.tags.slice(0, 2).join(", ");
  return clampWords(`Matches ${s.matched.join(", ")}${t ? ` — ${t}` : ""}; ${fmt(s.p.price, s.p.currency)}`, 15);
}

function fmt(price: number, currency: string) {
  return currency === "USD" ? `$${price.toFixed(2)}` : `${price.toFixed(2)} ${currency}`;
}

function toShelfHit(p: SearchableProduct, why: string): ShelfHit {
  return {
    source: "shelf",
    product_id: p.id,
    title: p.title,
    shop: p.shop_name,
    shop_slug: p.shop_slug,
    price: p.price,
    currency: p.currency,
    image_url: p.image_url,
    why,
    buyable_in_chat: true,
    published_at: p.shop_published_at,
  };
}

// ---------- public API ----------

/** Ranked, relevance-filtered products from published Shelf shops. Never throws for AI failures. */
export async function searchShelf(
  query: string,
  opts: { maxPrice?: number | null; limit?: number; session?: string | null } = {},
): Promise<ShelfHit[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(20, opts.limit ?? DEFAULT_LIMIT));
  const maxPrice = opts.maxPrice ?? parsePriceCap(q);

  const all = await listSearchableProducts({ session: opts.session ?? null });
  const pool = maxPrice != null ? all.filter((p) => p.price <= maxPrice) : all;
  if (pool.length === 0) return [];

  const terms = queryTerms(q);
  const scored = pool.map((p) => lexicalScore(p, terms)).sort((a, b) => b.score - a.score);

  // Candidates for the AI: lexical matches first, then pad with recent products so purely semantic
  // queries ("something for a coffee lover") still reach the model.
  const candidates = scored.slice(0, MAX_CANDIDATES).map((s) => s.p);

  try {
    const ranked = await rankWithClaude(q, maxPrice, candidates, limit);
    return ranked.map(({ p, why }) => toShelfHit(p, why));
  } catch (err) {
    console.warn("[search] Claude ranking failed, using lexical fallback:", err instanceof Error ? err.message : err);
  }

  // Lexical fallback: only title/tag matches close to the best one (keeps candles out of mug results).
  const top = scored[0]?.score ?? 0;
  if (top <= 0) return [];
  return scored
    .filter((s) => s.strong && s.score >= top * 0.7)
    .slice(0, limit)
    .map((s) => toShelfHit(s.p, lexicalWhy(s)));
}

function toMarketHit(m: MarketItem): MarketHit {
  return {
    source: "market",
    title: m.title,
    merchant: m.merchant ?? m.brand,
    price: m.price,
    currency: m.currency,
    image_url: m.imageUrl,
    buy_url: m.buyUrl,
    buyable_in_chat: false,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function searchMarketSafe(query: string, maxPrice: number | null): Promise<MarketHit[]> {
  try {
    const items = await withTimeout(
      searchMarket(stripPriceCap(query) || query, { maxPrice: maxPrice ?? undefined, limit: MARKET_LIMIT }),
      MARKET_TIMEOUT_MS,
      "Channel3 search",
    );
    return items.map(toMarketHit);
  } catch (err) {
    console.warn("[search] Channel3 search failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Shelf + Channel3 in parallel, then logs the search (the demand signal sellers see). */
export async function searchAll(
  query: string,
  opts: { maxPrice?: number | null; clientName?: string | null; session?: string | null } = {},
): Promise<{ shelf: ShelfHit[]; market: MarketHit[] }> {
  const q = query.trim();
  const maxPrice = opts.maxPrice ?? parsePriceCap(q);
  const [shelf, market] = await Promise.all([
    searchShelf(q, { maxPrice, session: opts.session ?? null }).catch((err) => {
      console.error("[search] Shelf search failed:", err);
      return [] as ShelfHit[];
    }),
    searchMarketSafe(q, maxPrice),
  ]);
  try {
    await logSearch({
      query: q,
      max_price: maxPrice,
      client_name: opts.clientName ?? null,
      shelf_hit_count: shelf.length,
      market_hit_count: market.length,
      top_product_id: shelf[0]?.product_id ?? null,
    });
  } catch (err) {
    console.error("[search] logSearch failed:", err);
  }
  return { shelf, market };
}
