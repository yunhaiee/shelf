// GET /api/shops/[id] -> { shop, products };  PATCH { name?, tagline?, about?, location?, paypal_email? } -> { shop }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, jsonError, readJson, requireShop } from "@/lib/auth";
import { listProducts, updateShop } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    return Response.json({ shop: auth.shop, products: await listProducts(id) });
  });
}

const optText = (max: number) => z.string().max(max).nullable().transform((s) => s?.trim() || null);
const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Shop name can't be empty.").max(120),
    tagline: optText(200),
    about: optText(2000),
    location: optText(120),
    paypal_email: z
      .string()
      .trim()
      .max(254)
      .nullable()
      .transform((s) => s || null)
      .refine((s) => s == null || z.email().safeParse(s).success, "PayPal email doesn't look like an email address."),
  })
  .partial();

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    const parsed = await readJson(req);
    if (!parsed.ok) return parsed.response;
    const patch = patchSchema.safeParse(parsed.body);
    if (!patch.success) return jsonError(400, patch.error.issues[0]?.message ?? "Invalid shop data.");
    if (auth.shop.status === "published" && "paypal_email" in patch.data && !patch.data.paypal_email)
      return jsonError(422, "A published shop needs a PayPal email. Unpublish first to remove it.");
    const shop = await updateShop(id, patch.data);
    if (!shop) return jsonError(404, "Shop not found.");
    return Response.json({ shop });
  });
}
