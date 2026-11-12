// /try: the one-link judge demo. Seller import -> publish -> Claude (over MCP) finds and buys -> PayPal Sandbox
// approval -> seller dashboard, all on one page. Each visitor works in a private demo session.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { appUrl } from "@/components/app-url";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { TryFlow } from "@/components/try/TryFlow";
import { DEMO_SHOP_SLUG } from "@/lib/demo";
import { getShopBySlug } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Try Shelf",
  description: "Run the whole Shelf demo in one page: a seller goes live from an Instagram caption, then Claude finds and buys from her with PayPal.",
};

const unquote = (s: string | undefined) => (s ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");

async function caption() {
  try {
    return (await readFile(path.join(process.cwd(), "demo-shop", "instagram.txt"), "utf8")).trim();
  } catch {
    return "";
  }
}

async function sampleAvailable() {
  try {
    const shop = await getShopBySlug(DEMO_SHOP_SLUG);
    return shop?.status === "published";
  } catch {
    return false;
  }
}

export default async function TryPage() {
  const [text, hasSample, base] = await Promise.all([caption(), sampleAvailable(), appUrl()]);
  // A public PayPal Sandbox test buyer, shown to judges on purpose. Not a real account.
  const buyer = {
    email: unquote(process.env.JUDGE_BUYER_EMAIL) || unquote(process.env.BUYER_PAYPAL_EMAIL),
    password: unquote(process.env.JUDGE_BUYER_PASSWORD) || unquote(process.env.BUYER_PAYPAL_PASSWORD),
  };
  return (
    <>
      <SiteHeader />
      <main>
        <TryFlow initialText={text} sampleAvailable={hasSample} buyer={buyer} mcpUrl={`${base}/api/mcp`} />
      </main>
      <SiteFooter />
    </>
  );
}
