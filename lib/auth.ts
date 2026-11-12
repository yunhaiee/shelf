// Seller auth (hackathon-grade): each shop has a secret edit token, returned once at creation.
// Sent as `x-shop-token` header or the httpOnly cookie `shelf_token_{shopId}`. Also small JSON helpers for seller API routes.
import { NextResponse, type NextRequest } from "next/server";
import { checkShopToken, getShopById } from "./repo";
import type { Shop } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | null | undefined): s is string => !!s && UUID_RE.test(s);

export const shopCookieName = (shopId: string) => `shelf_token_${shopId}`;

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Parses a JSON body; returns a 400 response instead of throwing on bad JSON. */
export async function readJson<T = unknown>(req: Request): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: (await req.json()) as T };
  } catch {
    return { ok: false, response: jsonError(400, "Request body must be valid JSON.") };
  }
}

export function tokenFromRequest(req: NextRequest | Request, shopId: string): string | null {
  const header = req.headers.get("x-shop-token")?.trim();
  if (header) return header;
  if ("cookies" in req && typeof req.cookies?.get === "function") return req.cookies.get(shopCookieName(shopId))?.value ?? null;
  const raw = req.headers.get("cookie") ?? "";
  const name = shopCookieName(shopId);
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export type ShopAuth = { shop: Shop; token: string };

/**
 * Checks the seller's token for `shopId`.
 * Returns `{ shop, token }` when valid, otherwise a ready-to-return NextResponse (404 bad id / 401 bad token).
 *
 *   const auth = await requireShop(req, id);
 *   if (auth instanceof Response) return auth;
 *   auth.shop ...
 */
export async function requireShop(req: NextRequest | Request, shopId: string): Promise<ShopAuth | NextResponse> {
  if (!isUuid(shopId)) return jsonError(404, "Shop not found.");
  const token = tokenFromRequest(req, shopId);
  if (!token) return jsonError(401, "Missing shop token. Send the x-shop-token header.");
  if (!(await checkShopToken(shopId, token))) return jsonError(401, "Invalid shop token.");
  const shop = await getShopById(shopId);
  if (!shop) return jsonError(404, "Shop not found.");
  return { shop, token };
}

/** Sets the httpOnly seller cookie (30 days). */
export function setShopCookie(res: NextResponse, shopId: string, token: string) {
  res.cookies.set(shopCookieName(shopId), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

/** Shop without the secret, safe to return from any API. */
export function publicShop(shop: Shop): Shop {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { edit_token, ...rest } = shop;
  return rest;
}

/** Wraps a route body so unexpected errors become `{ error }` JSON with status 500 (logged server-side). */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
    const known = (err as Error)?.name === "ImportError" || (err as Error)?.name === "AIError";
    if (!known) console.error("[api]", err);
    return jsonError(known ? status : 500, known ? (err as Error).message : "Something went wrong. Please try again.");
  }
}
