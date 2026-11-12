// Public base URL for server components and route handlers. Prefers APP_URL; falls back to the request host.
import "server-only";
import { headers } from "next/headers";

const clean = (u: string) => u.replace(/\/+$/, "");

export async function appUrl(): Promise<string> {
  if (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL) return clean((process.env.APP_URL || process.env.RENDER_EXTERNAL_URL)!);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function appUrlFromRequest(req: Request): string {
  if (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL) return clean((process.env.APP_URL || process.env.RENDER_EXTERNAL_URL)!);
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
