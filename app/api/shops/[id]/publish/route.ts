// POST /api/shops/[id]/publish -> validates then publishes -> { shop };  DELETE -> unpublish -> { shop }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, jsonError, requireShop } from "@/lib/auth";
import { listProducts, publishShop, unpublishShop } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;

    const products = await listProducts(id);
    const issues: string[] = [];
    if (products.length === 0) issues.push("Add at least one product.");
    const unpriced = products.filter((p) => !(p.price > 0));
    if (unpriced.length)
      issues.push(`Set a price above $0 for: ${unpriced.slice(0, 5).map((p) => p.title).join(", ")}${unpriced.length > 5 ? ` and ${unpriced.length - 5} more` : ""}.`);
    const email = auth.shop.paypal_email?.trim();
    if (!email) issues.push("Add the PayPal email where you want to get paid.");
    else if (!z.email().safeParse(email).success) issues.push("Your PayPal email doesn't look like an email address.");
    if (issues.length) return jsonError(422, `Can't publish yet: ${issues.join(" ")}`, { issues });

    const shop = await publishShop(id);
    if (!shop) return jsonError(404, "Shop not found.");
    return Response.json({ shop });
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const auth = await requireShop(req, id);
    if (auth instanceof Response) return auth;
    const shop = await unpublishShop(id);
    if (!shop) return jsonError(404, "Shop not found.");
    return Response.json({ shop });
  });
}
