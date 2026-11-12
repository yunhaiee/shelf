// Remote MCP endpoint (streamable HTTP, stateless, JSON responses). Add as a Claude "custom connector":
// ${APP_URL}/api/mcp — no auth.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createShelfServer, resolveClientName } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return jsonRpcError(413, -32000, "Request body too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonRpcError(400, -32700, "Parse error: invalid JSON");
  }

  // The transport insists on `Accept: application/json, text/event-stream`. We always answer with JSON,
  // so be lenient with clients (and curl) that only send one of them.
  const headers = new Headers(req.headers);
  const accept = headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    headers.set("accept", "application/json, text/event-stream");
  }
  if (!headers.get("content-type")?.toLowerCase().includes("application/json")) {
    headers.set("content-type", "application/json");
  }
  const forwarded = new Request(req.url, { method: "POST", headers });

  const server = createShelfServer({ clientName: resolveClientName(body, req.headers) });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: a fresh server + transport per request
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(forwarded, { parsedBody: body });
  } catch (err) {
    console.error("[mcp] request failed:", err);
    return jsonRpcError(500, -32603, "Internal server error");
  } finally {
    // JSON mode resolves only after every response is written, so closing here is safe.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

// No server-initiated SSE stream and no sessions in stateless mode.
export async function GET() {
  return jsonRpcError(405, -32000, "Method not allowed: this MCP server is stateless; use POST.", { allow: "POST" });
}

export async function DELETE() {
  return jsonRpcError(405, -32000, "Method not allowed: this MCP server is stateless; no session to delete.", {
    allow: "POST",
  });
}
