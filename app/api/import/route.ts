// POST /api/import {url?|text?} -> { shop, products: DraftProduct[] }. No DB write.
// With `Accept: application/x-ndjson` the response streams real progress instead, one JSON object per line:
//   {"type":"stage","stage":"read"} · {"type":"stage","stage":"write"} · {"type":"stage","stage":"prices","done":2,"total":6}
//   then {"type":"result","shop":{...},"products":[...]} or {"type":"error","status":422,"error":"..."}.
import type { NextRequest } from "next/server";
import { handle, jsonError, readJson } from "@/lib/auth";
import { importCatalog } from "@/lib/importer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Input = { url?: string; text?: string };

/** Same mapping as `handle`: seller-readable errors keep their message and status, anything else is generic. */
function describeError(err: unknown): { status: number; error: string } {
  const e = err as { name?: string; message?: string; status?: unknown };
  if ((e?.name === "ImportError" || e?.name === "AIError") && e.message) {
    return { status: typeof e.status === "number" ? e.status : 500, error: e.message };
  }
  console.error("[api/import]", err);
  return { status: 500, error: "Something went wrong. Please try again." };
}

function streamImport(input: Input): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The client may cancel mid-import; enqueue/close then throw and are safe to ignore.
      const send = (o: object) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          /* stream closed by the client */
        }
      };
      try {
        const result = await importCatalog(input, { onStage: (s) => send({ type: "stage", ...s }) });
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
      // no-transform keeps compression proxies from buffering the progress lines.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = await readJson<{ url?: unknown; text?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    const { url, text } = parsed.body ?? {};
    if (url != null && typeof url !== "string") return jsonError(400, "url must be a string.");
    if (text != null && typeof text !== "string") return jsonError(400, "text must be a string.");
    if (!url?.trim() && !text?.trim()) return jsonError(400, "Paste a shop link or a product list.");
    const input: Input = { url: url?.trim() || undefined, text: url?.trim() ? undefined : (text ?? undefined) };

    if (req.headers.get("accept")?.includes("application/x-ndjson")) return streamImport(input);
    return Response.json(await importCatalog(input));
  });
}
