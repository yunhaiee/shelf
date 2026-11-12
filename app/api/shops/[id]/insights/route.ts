// GET /api/shops/[id]/insights -> { insights } from network-wide agent searches (Claude Haiku).
import type { NextRequest } from "next/server";
import { demandInsights } from "@/lib/ai";
import { handle, requireShop } from "@/lib/auth";
import { listProducts, listRecentSearches } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    const [products, searches] = await Promise.all([listProducts(id), listRecentSearches(300)]);
    const insights = await demandInsights(auth.shop, products, searches);
    return Response.json({ insights });
  });
}
