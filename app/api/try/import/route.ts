// POST /api/try/import {text} -> NDJSON progress like /api/import, then {type:"result",shop,products}. No DB write.
// POST /api/try/import {sample:true} -> JSON {shop, products} copied from the published demo shop (no Claude call),
// for judges who want to skip the ~30s import.
import type { NextRequest } from "next/server";
import { handle, jsonError, readJson } from "@/lib/auth";
import { DEMO_SHOP_SLUG } from "@/lib/demo";
import { importCatalog } from "@/lib/importer";
import { getRealShopBySlug, listProducts } from "@/lib/repo";
import type { DraftProduct } from "@/lib/types";
import { MAX_TEXT_CHARS, rateLimit } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function describeError(err: unknown): { status: number; error: string } {
  const e = err as { name?: string; message?: string; status?: unknown };
  if ((e?.name === "ImportError" || e?.name === "AIError") && e.message) {
    return { status: typeof e.status === "number" ? e.status : 500, error: e.message };
  }
  console.error("[api/try/import]", err);
  return { status: 500, error: "Something went wrong. Please try again." };
}

async function readyMadeCopy() {
  const shop = await getRealShopBySlug(DEMO_SHOP_SLUG);
  if (!shop || shop.status !== "published") return null;
  const products = await listProducts(shop.id);
  if (products.length === 0) return null;
  const drafts: DraftProduct[] = products.map((p) => ({
    title: p.title,
    description: p.description,
    price: p.price,
    currency: p.currency,
    image_url: p.image_url,
    tags: p.tags,
    attributes: p.attributes,
    ai_fields: p.ai_fields,
    market_low: p.market_low,
    market_median: p.market_median,
    market_high: p.market_high,
    stock: Math.max(p.stock, 5),
  }));
  return {
    shop: { name: shop.name, tagline: shop.tagline, about: shop.about, location: shop.location },
    products: drafts,
  };
}

function streamImport(text: string): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: object) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          /* client went away */
        }
      };
      try {
        const result = await importCatalog({ text }, { onStage: (s) => send({ type: "stage", ...s }) });
        send({ type: "result", ...result });
      } catch (err) {
        send({ type: "error", ...describeError(err) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = await readJson<{ text?: unknown; sample?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    const { text, sample } = parsed.body ?? {};

    if (sample === true) {
      const copy = await readyMadeCopy();
      if (!copy) return jsonError(404, "The ready-made copy isn't available right now. Use Import instead.");
      return Response.json(copy);
    }

    if (typeof text !== "string" || !text.trim()) return jsonError(400, "Paste a product list first.");
    if (text.length > MAX_TEXT_CHARS) return jsonError(413, `Keep it under ${MAX_TEXT_CHARS} characters for the demo.`);
    const limited = rateLimit(req, "import");
    if (limited) return limited;

    if (req.headers.get("accept")?.includes("application/x-ndjson")) return streamImport(text);
    return Response.json(await importCatalog({ text }));
  });
}
