// PATCH /api/shops/[id]/products/[productId] (partial) -> { product }; edited fields leave ai_fields.  DELETE -> 204
import type { NextRequest } from "next/server";
import { handle, isUuid, jsonError, readJson, requireShop } from "@/lib/auth";
import { productPatchSchema } from "@/lib/importer";
import { deleteProduct, getProduct, updateProduct } from "@/lib/repo";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; productId: string }> };

async function ownedProduct(shopId: string, productId: string) {
  if (!isUuid(productId)) return null;
  const p = await getProduct(productId);
  return p && p.shop_id === shopId ? p : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id, productId } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    const existing = await ownedProduct(id, productId);
    if (!existing) return jsonError(404, "Product not found.");

    const parsed = await readJson(req);
    if (!parsed.ok) return parsed.response;
    const patch = productPatchSchema.safeParse(parsed.body);
    if (!patch.success) return jsonError(400, patch.error.issues[0]?.message ?? "Invalid product edit.");
    const data = patch.data;
    if (auth.shop.status === "published" && data.price !== undefined && !(data.price > 0))
      return jsonError(422, "Products in a live shop need a price above 0.");

    // Only fields whose value actually changed count as seller edits (the grid may send the whole row).
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => !same(data[k], existing[k as keyof Product]));
    if (changed.length === 0) return Response.json({ product: existing });

    const cleared = new Set<string>();
    for (const k of changed) {
      if (k !== "attributes") {
        cleared.add(k);
        continue;
      }
      cleared.add("attributes");
      const next = data.attributes ?? {};
      const keys = new Set([...Object.keys(existing.attributes ?? {}), ...Object.keys(next)]);
      for (const a of keys) if (!same(existing.attributes?.[a], next[a])) cleared.add(`attributes.${a}`);
    }
    const ai_fields = existing.ai_fields.filter((f) => !cleared.has(f));

    const update = Object.fromEntries(changed.map((k) => [k, data[k]])) as Partial<Product>;
    const product = await updateProduct(productId, { ...update, ai_fields });
    if (!product) return jsonError(404, "Product not found.");
    return Response.json({ product });
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id, productId } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    const existing = await ownedProduct(id, productId);
    if (!existing) return jsonError(404, "Product not found.");
    await deleteProduct(productId);
    if (await getProduct(productId))
      return jsonError(409, "This product has orders, so it can't be deleted. Set its stock to 0 to stop selling it.");
    return new Response(null, { status: 204 });
  });
}
