// Shared helpers for the /try one-link judge demo routes: session validation + in-memory per-IP rate limits.
// In-memory is fine here: one Render instance, demo-scale traffic.
import { jsonError } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A /try session id (crypto.randomUUID from the page), normalized to lowercase, or null if malformed. */
export function parseSession(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

export const MAX_TEXT_CHARS = 5000;
export const MAX_MESSAGES = 20;
export const MAX_PRODUCTS = 20;

const HOUR = 60 * 60 * 1000;
export const LIMITS = {
  import: { max: 6, windowMs: HOUR },
  publish: { max: 6, windowMs: HOUR },
  chat: { max: 40, windowMs: HOUR },
} as const;

const store = globalThis as unknown as { __shelfTryHits?: Map<string, number[]> };
const hits = (store.__shelfTryHits ??= new Map<string, number[]>());

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "local").split(",")[0].trim() || "local";
}

/** Records a hit; returns a 429 response when this IP is over the limit for `bucket`, else null. */
export function rateLimit(req: Request, bucket: keyof typeof LIMITS) {
  const { max, windowMs } = LIMITS[bucket];
  const key = `${bucket}|${clientIp(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    const retryMin = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 60_000));
    return jsonError(429, `Demo limit reached for this hour. Try again in about ${retryMin} min.`);
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return null;
}
