// The /try in-page assistant: Claude Sonnet 5.5 connected to Shelf's own MCP server through the Messages API MCP
// connector (Anthropic's servers call `${base}/api/mcp?session=...`). Model, system prompt and MCP URL are fixed
// server-side; the client only sends plain-text turns.
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/ai";

export const CHAT_MODEL = "claude-sonnet-5-5";
const MCP_BETA = "mcp-client-2025-11-20";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_TOKENS = 3000;
const MAX_CONTINUATIONS = 3; // pause_turn resumptions within one turn

const SYSTEM = `You are the shopping assistant inside the Shelf demo page, a hackathon demo for the PayPal AI Hackathon.
You are connected to Shelf over MCP. Shelf lists independent small shops whose products can be bought right here in the chat with PayPal.
- For any shopping or gift request, call search_products first. Present "Independent shops on Shelf" results first (buyable here); "Elsewhere on the web" results from Channel3 are links only.
- If nothing on Shelf fits, say so plainly and mention the link-out options. Don't invent products.
- To buy: if the shopper has clearly picked an item, call create_checkout right away (add a gift_note if given; if it ships to someone else, pass ship_to_name plus the full ship_to address fields). Then show the PayPal approval link exactly as returned, on its own line.
- This runs on PayPal Sandbox: the sandbox.paypal.com link is expected; the shopper approves with the sandbox test buyer shown on the page. No real money moves.
- When asked whether an order went through, call check_order with the order_id. Only say it's paid when check_order says PAID.
- Write plain text: short paragraphs or a short numbered list. No markdown headings, tables or bold. Keep replies under 140 words.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ToolCall = { name: string; input: string; result: string; is_error: boolean };
export type ChatResult = {
  reply: string;
  tools: ToolCall[];
  approveUrl: string | null;
  /** Reply plus compact tool notes, for the client to send back as this assistant turn's content next time. */
  history: string;
  stop_reason: string | null;
};

const APPROVE_RE = /https:\/\/(?:www\.)?sandbox\.paypal\.com\/[^\s<>"')\]]+/i;

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function resultText(content: string | Array<{ type: string; text?: string }>) {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("\n");
}

function shortInput(input: unknown) {
  if (!input || typeof input !== "object") return "";
  return clip(
    Object.entries(input as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`)
      .join(", "),
    160,
  );
}

/** One assistant turn, resolving MCP tool calls server-side. `mcpUrl` must be public https. */
export async function runChat(turns: ChatTurn[], mcpUrl: string): Promise<ChatResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const texts: string[] = [];
  const tools: ToolCall[] = [];
  const pending = new Map<string, { name: string; input: string }>();
  const fullResults: string[] = [];
  let stopReason: string | null = null;

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const res = await anthropic().beta.messages.create(
      {
        model: CHAT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages,
        output_config: { effort: "medium" },
        mcp_servers: [{ type: "url", url: mcpUrl, name: "shelf" }],
        tools: [{ type: "mcp_toolset", mcp_server_name: "shelf" }],
        betas: [MCP_BETA, FALLBACK_BETA],
        fallbacks: "default",
      },
      { timeout: 110_000 },
    );
    stopReason = res.stop_reason;
    for (const block of res.content) {
      if (block.type === "text") texts.push(block.text);
      else if (block.type === "mcp_tool_use") pending.set(block.id, { name: block.name, input: shortInput(block.input) });
      else if (block.type === "mcp_tool_result") {
        const call = pending.get(block.tool_use_id) ?? { name: "tool", input: "" };
        const full = resultText(block.content as string | Array<{ type: string; text?: string }>);
        fullResults.push(full);
        tools.push({ name: call.name, input: call.input, result: clip(full, 300), is_error: block.is_error });
      }
    }
    if (res.stop_reason !== "pause_turn") break;
    // Long tool chains can pause; resume by sending the assistant content back unchanged.
    messages.push({ role: "assistant", content: res.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });
  }

  const reply =
    texts.join("\n\n").trim() ||
    (stopReason === "refusal" ? "Sorry, I can't help with that one." : "I couldn't finish that. Try asking again.");
  const approveUrl = reply.match(APPROVE_RE)?.[0] ?? fullResults.map((r) => r.match(APPROVE_RE)?.[0]).find(Boolean) ?? null;

  // Keep ids (product_id / order_id) in history so later turns ("Did it go through?") can call tools again.
  const notes = tools
    .map((t, i) => {
      const full = fullResults[i] ?? t.result;
      const ids = [...new Set(full.match(/(?:product_id|order_id): [0-9a-f-]{36}/gi) ?? [])].slice(0, 6).join("; ");
      return `- ${t.name}(${t.input})${ids ? ` -> ${ids}` : ""}`;
    })
    .join("\n");
  const historyRaw = `${reply}${notes ? `\n\n[Shelf tool calls this turn]\n${notes}` : ""}`;
  const history = historyRaw.length <= 3000 ? historyRaw : `${historyRaw.slice(0, 2999)}…`;
  return { reply, tools, approveUrl, history, stop_reason: stopReason };
}
