// POST /api/shops { shop, products } -> creates a draft shop + products, sets the seller cookie -> { shop, products, token }
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, jsonError, publicShop, readJson, setShopCookie } from "@/lib/auth";
import { draftProductSchema } from "@/lib/importer";
import { createShop, insertProducts } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optText = (max: number) => z.string().max(max).nullable().optional().transform((s) => s?.trim() || null);

const bodySchema = z.object({
  shop: z.object({
    name: z.string().trim().min(1, "Your shop needs a name.").max(120),
    tagline: optText(200),
    about: optText(2000),
    location: optText(120),
    paypal_email: z
      .string()
      .trim()
      .max(254)
      .nullable()
      .optional()
      .transform((s) => s || null)
      .refine((s) => s == null || z.email().safeParse(s).success, "PayPal email doesn't look like an email address."),
    source_url: optText(2048),
  }),
  products: z.array(draftProductSchema).max(200, "Up to 200 products at a time."),
});

export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = await readJson(req);
    if (!parsed.ok) return parsed.response;
    const body = bodySchema.safeParse(parsed.body);
    if (!body.success) return jsonError(400, body.error.issues[0]?.message ?? "Invalid shop data.", { issues: body.error.issues });

    const { edit_token, ...shop } = await createShop(body.data.shop);
    const products = body.data.products.length ? await insertProducts(shop.id, body.data.products) : [];
    const res = NextResponse.json({ shop: publicShop(shop), products, token: edit_token }, { status: 201 });
    return setShopCookie(res, shop.id, edit_token);
  });
}
