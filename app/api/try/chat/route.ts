// POST /api/try/chat {session, messages:[{role,content}]} -> { reply, tools, approveUrl, history }
// Claude (via the Messages API MCP connector) talks to this deployment's own /api/mcp?session=<id>.
// The MCP URL must be public https, so this only works on the deployed site (or with TRY_MCP_BASE_URL set to a tunnel).
import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { appUrlFromRequest } from "@/components/app-url";
import { handle, jsonError, readJson } from "@/lib/auth";
import { runChat } from "../_chat";
import { MAX_MESSAGES, parseSession, rateLimit } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  session: z.string(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(MAX_MESSAGES, `Up to ${MAX_MESSAGES} messages. Reload the page to start a new chat.`),
});

function mcpBase(req: Request) {
  return (process.env.TRY_MCP_BASE_URL?.trim() || appUrlFromRequest(req)).replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const parsed = await readJson(req);
    if (!parsed.ok) return parsed.response;
    const body = bodySchema.safeParse(parsed.body);
    if (!body.success) return jsonError(400, body.error.issues[0]?.message ?? "Invalid chat request.");
    const session = parseSession(body.data.session);
    if (!session) return jsonError(400, "Missing or invalid demo session. Reload the page.");
    const turns = body.data.messages;
    if (turns[0].role !== "user" || turns[turns.length - 1].role !== "user") {
      return jsonError(400, "The conversation must start and end with a user message.");
    }

    const base = mcpBase(req);
    let host = "";
    try {
      host = new URL(base).hostname;
    } catch {
      /* handled below */
    }
    if (!base.startsWith("https://") || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return jsonError(
        503,
        "The in-page assistant runs on the deployed site (Claude has to reach Shelf's MCP server over public HTTPS).",
      );
    }

    const limited = rateLimit(req, "chat");
    if (limited) return limited;

    try {
      const result = await runChat(turns, `${base}/api/mcp?session=${session}`);
      return Response.json(result);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return jsonError(503, "Claude is busy right now. Try again in a minute.");
      if (err instanceof Anthropic.APIConnectionTimeoutError) return jsonError(504, "Claude took too long. Try again.");
      if (err instanceof Anthropic.APIError) {
        console.error("[api/try/chat] Anthropic error:", err.status, err.message);
        return jsonError(502, `Claude couldn't answer (${err.status ?? "network"}). Try again.`);
      }
      throw err;
    }
  });
}
