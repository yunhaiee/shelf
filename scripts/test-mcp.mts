// Shelf search + MCP smoke test.
//
//   npx tsx --env-file=.env scripts/test-mcp.mts          # direct: temp shop, searchShelf ranking check,
//                                                          # then JSON-RPC straight into app/api/mcp/route.ts POST
//   npx tsx --env-file=.env scripts/test-mcp.mts --http   # against a running server at ${APP_URL}/api/mcp
//                                                          # with the MCP SDK Client (list tools, search)
//
// Direct mode inserts a temporary published shop with 3 products and deletes it (and the search-log rows it
// produced, tagged client "shelf-test") at the end, even on failure.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pool, query } from "../lib/db.ts";
import { createShop, insertProducts, publishShop } from "../lib/repo.ts";
import { searchShelf } from "../lib/search.ts";
import type { DraftProduct } from "../lib/types.ts";

const TEST_CLIENT = "shelf-test";
const QUERY = "speckled mug gift under $40";

function draft(p: Partial<DraftProduct> & Pick<DraftProduct, "title" | "price">): DraftProduct {
  return {
    description: null,
    currency: "USD",
    image_url: null,
    tags: [],
    attributes: {},
    ai_fields: [],
    market_low: null,
    market_median: null,
    market_high: null,
    stock: 5,
    ...p,
  };
}

function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function httpMode() {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const client = new Client({ name: TEST_CLIENT, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
  console.log("server:", client.getServerVersion());
  console.log("instructions:\n" + client.getInstructions() + "\n");
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const res = await client.callTool({ name: "search_products", arguments: { query: process.argv[3] ?? QUERY } });
  for (const c of res.content as { type: string; text?: string }[]) if (c.type === "text") console.log("\n" + c.text);
  await client.close();
}

async function rpc(POST: (req: Request) => Promise<Response>, body: unknown, label: string) {
  const res = await POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "shelf-test/1.0",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  console.log(`\n=== ${label} -> HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function directMode() {
  const { POST, GET } = await import("../app/api/mcp/route.ts");

  const shop = await createShop({
    name: `Shelf Test Studio ${Math.random().toString(36).slice(2, 7)}`,
    tagline: "temporary test shop",
    about: "Created by scripts/test-mcp.mts and deleted at the end of the run.",
    location: "Testville, CA",
    paypal_email: process.env.SELLER_PAYPAL_EMAIL ?? null,
    source_url: "test",
  });
  try {
    const [mug, candle, bowl] = await insertProducts(shop.id, [
      draft({
        title: "Speckled Stoneware Mug",
        price: 28,
        description: "Wheel-thrown 12 oz mug in an oatmeal glaze with iron speckles. A cozy everyday mug.",
        tags: ["mug", "speckled", "stoneware", "handmade", "coffee", "gift", "kitchen"],
        attributes: { material: "stoneware", color: "oatmeal speckled", capacity: "12 oz", care: "dishwasher safe", handmade: true },
      }),
      draft({
        title: "Fig & Cedar Soy Candle",
        price: 24,
        description: "Hand-poured soy candle in a reusable amber jar. 40-hour burn.",
        tags: ["candle", "soy", "gift", "home fragrance", "cozy"],
        attributes: { material: "soy wax", capacity: "8 oz", handmade: true },
      }),
      draft({
        title: "Speckled Serving Bowl",
        price: 36,
        description: "A wide stoneware serving bowl with a speckled glaze, for salads and pasta.",
        tags: ["bowl", "speckled", "stoneware", "serving", "kitchen", "gift"],
        attributes: { material: "stoneware", dimensions: "10 in wide", handmade: true },
      }),
    ]);
    await publishShop(shop.id);
    console.log(`temp shop ${shop.slug}: mug=${mug.id} candle=${candle.id} bowl=${bowl.id}`);

    // 1) Ranking
    const t0 = Date.now();
    const hits = await searchShelf(QUERY);
    console.log(`\nsearchShelf(${JSON.stringify(QUERY)}) in ${Date.now() - t0}ms:`);
    hits.forEach((h, i) => console.log(`  ${i + 1}. ${h.title} — $${h.price} — ${h.shop} — ${h.why}`));
    check(hits[0]?.product_id === mug.id, "mug ranks first");
    check(!hits.some((h) => h.product_id === candle.id), "candle excluded");

    // 2) MCP route, called in-process
    const init = await rpc(
      POST,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: TEST_CLIENT, version: "1.0.0" } },
      },
      "initialize",
    );
    console.log(JSON.stringify(init.json, null, 2));
    check(init.json?.result?.serverInfo?.name === "shelf", "initialize returns serverInfo shelf");

    const note = await rpc(POST, { jsonrpc: "2.0", method: "notifications/initialized" }, "notifications/initialized");
    check(note.status === 202, "notification accepted with 202");

    const list = await rpc(POST, { jsonrpc: "2.0", id: 2, method: "tools/list" }, "tools/list");
    const tools = (list.json?.result?.tools ?? []) as { name: string; description: string; inputSchema: unknown }[];
    for (const t of tools) console.log(`- ${t.name}: ${JSON.stringify(t.inputSchema)}`);
    check(
      ["search_products", "get_product", "create_checkout", "check_order"].every((n) => tools.some((t) => t.name === n)),
      "tools/list has all 4 tools",
    );

    const call = await rpc(
      POST,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_products", arguments: { query: QUERY } } },
      "tools/call search_products",
    );
    const result = call.json?.result;
    console.log(result?.content?.[0]?.text);
    console.log("structuredContent.shelf ids:", (result?.structuredContent?.shelf ?? []).map((h: { product_id: string }) => h.product_id));
    check(result?.structuredContent?.shelf?.[0]?.product_id === mug.id, "MCP search: mug first");

    const detail = await rpc(
      POST,
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_product", arguments: { product_id: mug.id } } },
      "tools/call get_product",
    );
    console.log(detail.json?.result?.content?.[0]?.text);
    check(detail.json?.result?.isError !== true, "get_product ok");

    const bad = await rpc(
      POST,
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_product", arguments: { product_id: "nope" } } },
      "tools/call get_product (bad id)",
    );
    check(bad.json?.result?.isError === true, "bad product_id -> isError tool result");

    const logged = await query<{ client_name: string; shelf_hit_count: number; top_product_id: string }>(
      `select client_name, shelf_hit_count, top_product_id from searches where client_name = $1 order by created_at desc limit 1`,
      [TEST_CLIENT],
    );
    console.log("\nlogged search:", logged[0]);
    check(logged[0]?.top_product_id === mug.id, "search logged with client attribution + top product");

    const get = await GET();
    console.log(`\nGET -> HTTP ${get.status} ${await get.text()}`);
    check(get.status === 405, "GET is 405");
  } finally {
    // Test-only cleanup (no repo helper exists for deleting shops).
    await query(`delete from searches where client_name = $1`, [TEST_CLIENT]);
    await query(`delete from shops where id = $1 and source_url = 'test'`, [shop.id]);
    console.log("\ncleaned up temp shop + test search rows");
  }
}

try {
  if (process.argv.includes("--http")) await httpMode();
  else await directMode();
} finally {
  await pool().end();
}
