// POST /api/shops/[id]/products  DraftProduct -> { product }
import type { NextRequest } from "next/server";
import { handle, jsonError, readJson, requireShop } from "@/lib/auth";
import { draftProductSchema } from "@/lib/importer";
import { insertProducts } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    const parsed = await readJson(req);
    if (!parsed.ok) return parsed.response;
    const draft = draftProductSchema.safeParse(parsed.body);
    if (!draft.success) return jsonError(400, draft.error.issues[0]?.message ?? "Invalid product.");
    if (auth.shop.status === "published" && !(draft.data.price && draft.data.price > 0))
      return jsonError(422, "Products in a live shop need a price above 0.");
    const [product] = await insertProducts(id, [draft.data]);
    return Response.json({ product }, { status: 201 });
  });
}
