import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteChrome";
import { SellFlow } from "@/components/sell/SellFlow";

export const metadata: Metadata = {
  title: "Open your shop",
  description: "Turn your shop link or product list into a catalog AI assistants can search and buy from.",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SellPage({ searchParams }: { searchParams: Promise<{ shop?: string | string[] }> }) {
  const { shop } = await searchParams;
  const id = typeof shop === "string" && UUID_RE.test(shop) ? shop : null;
  return (
    <>
      <SiteHeader current="sell" />
      <main>
        <SellFlow key={id ?? "new"} resumeShopId={id} />
      </main>
    </>
  );
}
