// Shared Anthropic client + structured-output helper + seller demand insights. Server-only.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Product, SearchLog, Shop } from "./types";

export const MODELS = {
  extract: "claude-sonnet-5-5", // catalog extraction + enrichment
  small: "claude-haiku-5-5", // ranking, insights, other small calls
} as const;

const SONNET_FALLBACK_BETA = "server-side-fallback-2026-07-01";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  _client ??= new Anthropic({ maxRetries: 2 });
  return _client;
}

/** A failed AI call with a message that is safe to show a seller. `status` is the HTTP status a route should use. */
export class AIError extends Error {
  constructor(
    message: string,
    public status = 502,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "AIError";
  }
}

type Effort = "low" | "medium" | "high";

/**
 * One structured-output call: the response is constrained to `schema` (JSON schema derived from zod)
 * and validated again on our side. Throws AIError on refusal, truncation, invalid output, timeout or API failure.
 */
export async function structured<S extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: S;
  maxTokens: number;
  timeoutMs: number;
  effort?: Effort;
  signal?: AbortSignal;
  what?: string; // human label for error messages, e.g. "reading your catalog"
}): Promise<z.infer<S>> {
  const what = opts.what ?? "the AI step";
  const isSonnet = opts.model.startsWith("claude-sonnet-5-5");
  let msg;
  try {
    msg = await anthropic().beta.messages.parse(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.effort ?? "low" },
        // Sonnet 5.5: on a (rare, false-positive) policy decline, the API re-runs on its default fallback model.
        ...(isSonnet && { betas: [SONNET_FALLBACK_BETA], fallbacks: "default" as const }),
      },
      { timeout: opts.timeoutMs, signal: opts.signal },
    );
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError)
      throw new AIError(`Timed out while ${what}. Try again, or paste a shorter list.`, 504, err);
    if (err instanceof Anthropic.RateLimitError)
      throw new AIError(`The AI is busy right now (rate limited) while ${what}. Try again in a minute.`, 503, err);
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
      throw new AIError("The AI service is not configured correctly (check ANTHROPIC_API_KEY).", 500, err);
    if (err instanceof Anthropic.BadRequestError)
      throw new AIError(`The AI request was rejected while ${what}: ${err.message}`, 502, err);
    if (err instanceof Anthropic.APIError) throw new AIError(`AI service error while ${what} (${err.status ?? "network"}).`, 502, err);
    // Non-API errors from .parse() mean the model's JSON did not match the schema.
    throw new AIError(`The AI returned output we couldn't read while ${what}. Try again.`, 502, err);
  }

  if (msg.stop_reason === "refusal")
    throw new AIError(`The AI declined this content while ${what}. Try rephrasing or removing unusual text.`, 422);
  if (msg.stop_reason === "max_tokens")
    throw new AIError(`Too much content to process at once while ${what}. Try a smaller list or a single page.`, 413);

  const parsed = msg.parsed_output;
  if (parsed == null) throw new AIError(`The AI returned no usable result while ${what}. Try again.`, 502);
  const check = opts.schema.safeParse(parsed);
  if (!check.success) throw new AIError(`The AI returned invalid data while ${what}. Try again.`, 502, check.error);
  return check.data;
}

// ---------- demand insights ----------

export type Insight = { headline: string; detail: string; query_examples: string[]; count: number };

const InsightsSchema = z.object({
  insights: z.array(
    z.object({
      headline: z.string(),
      detail: z.string(),
      query_examples: z.array(z.string()),
    }),
  ),
});

const normQuery = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Up to 3 actionable insights for one seller from network-wide agent searches.
 * Searches are aggregated in code (counts are exact); the model only picks which demand is relevant to this
 * shop's category and words it. Returns [] when there is no search data.
 */
export async function demandInsights(shop: Shop, products: Product[], searches: SearchLog[]): Promise<Insight[]> {
  if (searches.length === 0) return [];
  const mine = new Set(products.map((p) => p.id));

  const groups = new Map<string, { query: string; count: number; unmet: number; matchedYou: number; maxPrices: number[]; clients: Set<string> }>();
  for (const s of searches) {
    const key = normQuery(s.query);
    if (!key) continue;
    const g = groups.get(key) ?? { query: key, count: 0, unmet: 0, matchedYou: 0, maxPrices: [], clients: new Set<string>() };
    g.count++;
    if (s.shelf_hit_count === 0) g.unmet++;
    if (s.top_product_id && mine.has(s.top_product_id)) g.matchedYou++;
    if (s.max_price != null) g.maxPrices.push(s.max_price);
    if (s.client_name) g.clients.add(s.client_name);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 150);

  const catalog = products
    .slice(0, 60)
    .map((p) => `- ${p.title} ($${p.price}) [${p.tags.slice(0, 6).join(", ")}]`)
    .join("\n");
  const table = rows
    .map((r) => {
      const price = r.maxPrices.length ? ` max_price≈$${Math.round(r.maxPrices.reduce((a, b) => a + b, 0) / r.maxPrices.length)}` : "";
      return `"${r.query}" ×${r.count} (no Shelf result ${r.unmet}×, your product was top ${r.matchedYou}×)${price}`;
    })
    .join("\n");

  const out = await structured({
    model: MODELS.small,
    what: "analyzing agent demand",
    maxTokens: 2000,
    timeoutMs: 20_000,
    effort: "low",
    schema: InsightsSchema,
    system: `You help an independent maker understand what AI shopping assistants are asking for.
You get the seller's catalog and a table of real, aggregated agent search queries from across the Shelf network.
Pick at most 3 insights that are RELEVANT to this seller's category (ignore queries for unrelated categories).
Prefer: unmet demand they could fill with a new product, demand they already match (make sure it's well tagged), and price expectations (max_price) vs their prices.
- headline: short and concrete. Write the search count as the literal placeholder {count}; we fill in the exact total for your query_examples. Example: "Agents asked for 'speckled bowl' {count}× — you don't sell one". Never write other search counts yourself.
- detail: one or two plain sentences with a specific suggestion. Prices you mention must come from the table or catalog.
- query_examples: the exact query strings from the table that this insight is about (all of them).
If nothing is relevant, return an empty list.`,
    user: `Shop: ${shop.name}${shop.tagline ? ` — ${shop.tagline}` : ""}\n${shop.about ?? ""}\n\nCatalog:\n${catalog || "(no products yet)"}\n\nAgent searches (last ${searches.length}):\n${table}`,
  });

  return out.insights.slice(0, 3).flatMap((i) => {
    const matched = [...new Set(i.query_examples.map(normQuery))].filter((q) => groups.has(q));
    const examples = matched.slice(0, 5);
    const count = matched.reduce((n, q) => n + (groups.get(q)?.count ?? 0), 0);
    if (count === 0) return []; // every insight must be backed by real searches
    const headline = i.headline.includes("{count}") ? i.headline.replaceAll("{count}", String(count)) : i.headline;
    return [{ headline, detail: i.detail.replaceAll("{count}", String(count)), query_examples: examples, count }];
  });
}
