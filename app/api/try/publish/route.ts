// POST /api/try/publish {session, shop, products} -> creates + publishes a demo-session copy of the shop, paid to the
// sandbox seller (SELLER_PAYPAL_EMAIL, server-side). Sets the seller cookie so /dash/<id> works for this judge.
// Each call first deletes demo shops older than 12h, and replaces this session's previous copy.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, jsonError, publicShop, readJson, setShopCookie } from "@/lib/auth";
import { draftProductSchema } from "@/lib/importer";
import {
  createShop,
  deleteShopWithOrders,
  deleteStaleDemoShops,
  getDemoSessionShop,
  insertProducts,
  publishShop,
} from "@/lib/repo";
import { MAX_PRODUCTS, parseSession, rateLimit } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optText = (max: number) => z.string().max(max).nullable().optional().transform((s) => s?.trim() || null);

const bodySchema = z.object({
  session: z.string(),
  shop: z.object({
    name: z.string().trim().min(1, "The shop needs a name.").max(120),
    tagline: optText(200),
    about: optText(2000),
    location: optText(120),
  }),
  products: z.array(draftProductSchema).min(1, "Import some products first.").max(MAX_PRODUCTS),
});

export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = await readJson(req);
    if (!parsed.ok) return parsed.response;
    const body = bodySchema.safeParse(parsed.body);
    if (!body.success) return jsonError(400, body.error.issues[0]?.message ?? "Invalid shop data.");
    const session = parseSession(body.data.session);
    if (!session) return jsonError(400, "Missing or invalid demo session. Reload the page.");
    const paypalEmail = process.env.SELLER_PAYPAL_EMAIL?.trim().replace(/^["']|["']$/g, "");
    if (!paypalEmail) return jsonError(500, "The demo seller's PayPal account isn't configured.");
    const limited = rateLimit(req, "publish");
    if (limited) return limited;

    try {
      const removed = await deleteStaleDemoShops(12);
      if (removed) console.log(`[try] cleaned up ${removed} stale demo shop(s)`);
    } catch (err) {
      console.warn("[try] demo cleanup failed:", err instanceof Error ? err.message : err);
    }

    // Publishing requires a price on every product. Fill a missing one from the Channel3 median, else drop it.
    const products = body.data.products
      .map((p) => {
        if (p.price != null && p.price > 0) return p;
        if (p.market_median != null && p.market_median > 0) {
          return { ...p, price: Math.max(1, Math.round(p.market_median)), ai_fields: [...new Set([...p.ai_fields, "price"])] };
        }
        return null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (products.length === 0) return jsonError(400, "None of these products has a price yet.");

    const previous = await getDemoSessionShop(session);
    if (previous) await deleteShopWithOrders(previous.id);

    const { edit_token, ...created } = await createShop({
      ...body.data.shop,
      paypal_email: paypalEmail,
      source_url: "try",
      demo_session: session,
    });
    const saved = await insertProducts(created.id, products);
    const shop = (await publishShop(created.id)) ?? created;

    const res = NextResponse.json(
      { shop: { ...publicShop(shop), paypal_email: null }, products: saved, token: edit_token },
      { status: 201 },
    );
    return setShopCookie(res, shop.id, edit_token);
  });
}
