// GET /api/health — liveness + which settings are configured (booleans only; never values).
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const KEYS = [
  "DATABASE_URL", "APP_URL", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID",
  "SELLER_PAYPAL_EMAIL", "PLATFORM_PAYPAL_EMAIL", "CHANNEL3_API_KEY", "ANTHROPIC_API_KEY",
] as const;

export async function GET() {
  const env = Object.fromEntries(KEYS.map((k) => [k, Boolean(process.env[k]?.trim())]));
  let db = false;
  try {
    await query("select 1");
    db = true;
  } catch {}
  return Response.json({ ok: db, db, env, base_url: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || null });
}
