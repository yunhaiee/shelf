// GET /api/dash/demo -> the demo shop's dashboard feed, read-only and redacted (no token needed).
import { demoDashboard, getDemoShop } from "@/lib/demo";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function GET() {
  try {
    const shop = await getDemoShop();
    if (!shop) return Response.json({ error: "The demo shop isn't published right now." }, { status: 404, headers: noStore });
    return Response.json(await demoDashboard(shop), { headers: noStore });
  } catch (err) {
    console.error("[api/dash/demo] failed", err);
    return Response.json({ error: "Couldn't load the dashboard. Try again in a moment." }, { status: 500, headers: noStore });
  }
}
