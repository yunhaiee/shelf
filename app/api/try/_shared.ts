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

/** Per-bucket cap across all IPs, so one abuser can't drain the API budget. */
const GLOBAL_MAX = { import: 60, publish: 60, chat: 300 } as const;

/**
 * The client IP as Render's edge saw it. Never the first X-Forwarded-For entry (the client can send that):
 * prefer the edge-set cf-connecting-ip / true-client-ip, else the rightmost X-Forwarded-For hop.
 */
export function clientIp(req: Request) {
  const edge = req.headers.get("cf-connecting-ip") ?? req.headers.get("true-client-ip");
  if (edge?.trim()) return edge.trim();
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] || req.headers.get("x-real-ip")?.trim() || "local";
}

function take(key: string, max: number, windowMs: number, now: number) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 60_000));
  }
  recent.push(now);
  hits.set(key, recent);
  return 0;
}

/** Records a hit; returns a 429 response when this IP is over the limit for `bucket`, else null. */
export function rateLimit(req: Request, bucket: keyof typeof LIMITS) {
  const { max, windowMs } = LIMITS[bucket];
  const now = Date.now();
  const ipKey = `${bucket}|${clientIp(req)}`;
  const globalKey = `${bucket}|*`;
  // Check the per-IP bucket first so a limited IP doesn't also eat the shared budget.
  const retryMin = take(ipKey, max, windowMs, now) || take(globalKey, GLOBAL_MAX[bucket], windowMs, now);
  if (retryMin) return jsonError(429, `Demo limit reached for this hour. Try again in about ${retryMin} min.`);
  if (hits.size > 5000) {
    const oldest = [...hits.keys()].find((k) => !k.endsWith("|*"));
    if (oldest) hits.delete(oldest);
  }
  return null;
}
