import Link from "next/link";
import { listProducts, listPublishedShops } from "@/lib/repo";
import type { Shop } from "@/lib/types";
import { appUrl } from "@/components/app-url";
import { CopyButton } from "@/components/CopyButton";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { money } from "@/components/format";

export const dynamic = "force-dynamic";

type ShopSummary = Shop & { productCount: number; minPrice: number | null; maxPrice: number | null };

async function loadShops(): Promise<ShopSummary[]> {
  try {
    const shops = await listPublishedShops();
    return await Promise.all(
      shops.slice(0, 24).map(async (s) => {
        const products = await listProducts(s.id);
        const prices = products.map((p) => p.price).filter((p) => p > 0);
        return {
          ...s,
          productCount: products.length,
          minPrice: prices.length ? Math.min(...prices) : null,
          maxPrice: prices.length ? Math.max(...prices) : null,
        };
      }),
    );
  } catch (err) {
    console.error("[home] could not load shops", err);
    return [];
  }
}

const SALE_STEPS = [
  {
    title: "Paste your shop link, a caption or a messy list.",
    body: "Shelf reads it and writes what assistants need to recommend a piece with confidence: size, material, care, who it suits.",
  },
  {
    title: "Check prices against the market.",
    body: "Channel3 finds what similar items sell for across online stores, so a missing price gets a sensible suggestion.",
  },
  {
    title: "Publish.",
    body: "Your catalog is live in every assistant connected to Shelf, and on an open page any AI can read.",
  },
  {
    title: "A shopper asks. Claude sells.",
    body: "The shopper approves a PayPal payment from the chat. The money goes straight to your PayPal account, and the order lands on your dashboard.",
  },
];

export default async function Home() {
  const [base, shops] = await Promise.all([appUrl(), loadShops()]);
  const mcpUrl = `${base}/api/mcp`;

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="wrap grid gap-14 pb-20 pt-14 sm:pt-24 lg:grid-cols-12 lg:gap-12 lg:pb-28">
          <div className="lg:col-span-7">
            <h1 className="display rise text-[54px] sm:text-[84px] lg:text-[100px]">Make any small shop buyable by AI.</h1>
            <p className="rise rise-2 prose-measure mt-8 text-[18px] leading-[1.6] text-ink/80 sm:text-[19px]">
              People ask AI assistants to shop for them. Assistants can find independent makers, but only as a link out of
              the chat. Shelf turns your shop into a catalog assistants can search and buy from, with PayPal checkout that
              pays you directly.
            </p>
            <div className="rise rise-3 mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Link href="/sell" className="btn">
                Open your shop
              </Link>
              <a href="#connect" className="link text-[15px]">
                Connect Shelf to Claude
              </a>
            </div>
            <Link href="/try" className="rise rise-3 link mt-5 inline-block text-[15px]">
              Try the whole flow in one page &rarr;
            </Link>
          </div>

          <figure className="lg:col-span-5 lg:pt-4" aria-label="Example conversation in Claude">
            <figcaption className="eyebrow mb-6">In Claude, two minutes after a shop publishes</figcaption>
            <div className="border-l border-line pl-6 text-[15px] leading-[1.6]">
              <p className="text-[12px] font-medium text-muted">You</p>
              <p className="mt-1">Use Shelf to find a speckled mug from a small studio, under $40. It&rsquo;s a gift.</p>

              <p className="mt-7 text-[12px] font-medium text-muted">Claude</p>
              <p className="mt-1">
                On Shelf: the <span className="font-medium">Speckled mug</span> from Hanul Clay, a one-person studio in
                Oakland. Stoneware, holds 12 oz, dishwasher safe. $28, and I can check out here.
              </p>
              <div className="mt-5 flex items-center justify-between gap-4 border border-ink px-4 py-3">
                <span className="text-[14px] font-medium">Approve with PayPal</span>
                <span className="mono text-[13px]">$28.00</span>
              </div>
              <p className="mt-3 text-[13px] text-muted">Paid. Hanul Clay has your order.</p>
            </div>
          </figure>
        </section>

        <hr className="rule" />

        {/* Two entry points */}
        <section className="wrap grid md:grid-cols-2">
          <div className="py-14 md:pr-12 lg:py-20">
            <p className="eyebrow">For sellers</p>
            <h2 className="display mt-4 text-[40px] sm:text-[48px]">Open your shop</h2>
            <p className="prose-measure mt-5 text-[17px] leading-[1.5]">
              Agentic commerce is being built for sellers with catalogs. Shelf is for the ones who sell from a caption.
            </p>
            <p className="prose-measure mt-4 text-ink/80">
              Bring the shop you already have. Shelf reads your site, an Instagram caption or a pasted list, fills in the details assistants ask
              about, and puts you in front of every assistant connected to Shelf. No new storefront, no app for your
              customers to install.
            </p>
            <Link href="/sell" className="btn mt-8">
              Open your shop
            </Link>
          </div>

          <div id="connect" className="scroll-mt-8 border-t border-line py-14 md:border-l md:border-t-0 md:pl-12 lg:py-20">
            <p className="eyebrow">For shoppers</p>
            <h2 className="display mt-4 text-[40px] sm:text-[48px]">Connect Shelf to Claude</h2>
            <p className="prose-measure mt-5 text-ink/80">
              Add Shelf once. Claude can then search independent shops and buy for you, with every payment approved by you
              in PayPal.
            </p>

            <div className="mt-8">
              <p className="label">Connector URL</p>
              <div className="flex items-stretch border border-line bg-surface">
                <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-4 py-3 text-[14px]">{mcpUrl}</code>
                <CopyButton value={mcpUrl} className="link border-l border-line px-4 text-[13px] no-underline" />
              </div>
            </div>

            <ol className="mt-8 space-y-4 text-[15px]">
              {[
                <>
                  In Claude, open <span className="font-medium">Settings</span>, then{" "}
                  <span className="font-medium">Connectors</span>.
                </>,
                <>
                  Choose <span className="font-medium">Add custom connector</span>, name it Shelf, and paste the URL above.
                </>,
                <>Ask Claude: &ldquo;Use Shelf to find &hellip;&rdquo;. When you&rsquo;re ready, approve the PayPal link.</>,
              ].map((step, i) => (
                <li key={i} className="grid grid-cols-[28px_1fr] gap-2">
                  <span className="mono pt-[2px] text-[13px] text-muted">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <hr className="rule" />

        {/* How a sale happens */}
        <section className="wrap py-16 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-12">
            <h2 className="display text-[36px] sm:text-[44px] lg:col-span-4">How a sale happens</h2>
            <ol className="lg:col-span-8">
              {SALE_STEPS.map((s, i) => (
                <li
                  key={s.title}
                  className="grid grid-cols-[36px_1fr] gap-3 border-t border-line py-6 last:border-b sm:grid-cols-[56px_1fr]"
                >
                  <span className="mono pt-[3px] text-[13px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="text-[17px] font-medium">{s.title}</p>
                    <p className="prose-measure mt-1.5 text-ink/75">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <hr className="rule" />

        {/* Published shops */}
        <section className="wrap py-16 lg:py-24">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="display text-[36px] sm:text-[44px]">On Shelf now</h2>
            <p className="text-[14px] text-muted">
              {shops.length === 0
                ? "No shops yet."
                : `${shops.length} ${shops.length === 1 ? "shop" : "shops"} assistants can buy from`}
            </p>
          </div>

          {shops.length === 0 ? (
            <p className="mt-8 text-ink/80">
              Be the first.{" "}
              <Link href="/sell" className="link">
                Open your shop
              </Link>{" "}
              and it appears here the moment you publish.
            </p>
          ) : (
            <ul className="mt-10 border-t border-line">
              {shops.map((s) => (
                <li key={s.id} className="border-b border-line">
                  <Link
                    href={`/s/${s.slug}`}
                    className="group grid gap-1 py-6 no-underline sm:grid-cols-12 sm:items-baseline sm:gap-6"
                  >
                    <span className="display text-[28px] leading-tight transition-colors group-hover:text-accent sm:col-span-4">
                      {s.name}
                    </span>
                    <span className="text-ink/75 sm:col-span-5">{s.tagline || s.about?.slice(0, 120) || ""}</span>
                    <span className="text-[13px] text-muted sm:col-span-3 sm:text-right">
                      {[
                        s.location,
                        `${s.productCount} ${s.productCount === 1 ? "piece" : "pieces"}`,
                        s.minPrice != null
                          ? s.minPrice === s.maxPrice
                            ? money(s.minPrice)
                            : `${money(s.minPrice)}–${money(s.maxPrice)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
