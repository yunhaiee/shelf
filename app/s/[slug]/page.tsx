import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getShopBySlug, listProducts } from "@/lib/repo";
import type { Product, Shop } from "@/lib/types";
import { appUrl } from "@/components/app-url";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { money } from "@/components/format";

export const dynamic = "force-dynamic";

const loadShop = cache(async (slug: string) => {
  const shop = await getShopBySlug(slug);
  if (!shop || shop.status !== "published") return null;
  const products = await listProducts(shop.id);
  return { shop, products };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadShop(slug).catch(() => null);
  if (!data) return { title: "Shop not found" };
  const { shop } = data;
  const description = shop.tagline || shop.about?.slice(0, 160) || `Independent shop on Shelf. Buy inside your AI assistant.`;
  return {
    title: shop.name,
    description,
    alternates: { canonical: `/s/${shop.slug}` },
    openGraph: { title: shop.name, description, type: "website" },
  };
}

const ATTR_LABELS: [string, string][] = [
  ["material", "Material"],
  ["dimensions", "Size"],
  ["capacity", "Capacity"],
  ["color", "Color"],
  ["care", "Care"],
];

function attrRows(p: Product) {
  const a = p.attributes ?? {};
  const rows: [string, string][] = [];
  for (const [k, label] of ATTR_LABELS) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) rows.push([label, v]);
  }
  if (a.handmade === true) rows.push(["Made", "By hand"]);
  return rows;
}

function jsonLd(shop: Shop, products: Product[], base: string) {
  const shopUrl = `${base}/s/${shop.slug}`;
  const seller = { "@type": "Organization", name: shop.name, url: shopUrl };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Store",
        "@id": `${shopUrl}#store`,
        name: shop.name,
        url: shopUrl,
        description: shop.about || shop.tagline || undefined,
        ...(shop.location ? { address: { "@type": "PostalAddress", addressLocality: shop.location } } : {}),
      },
      ...products.map((p) => ({
        "@type": "Product",
        "@id": `${shopUrl}#${p.id}`,
        productID: p.id,
        sku: p.id,
        name: p.title,
        description: p.description || undefined,
        image: p.image_url && !p.image_url.startsWith("data:") ? p.image_url : undefined,
        brand: { "@type": "Brand", name: shop.name },
        material: typeof p.attributes?.material === "string" ? p.attributes.material : undefined,
        color: typeof p.attributes?.color === "string" ? p.attributes.color : undefined,
        keywords: p.tags?.length ? p.tags.join(", ") : undefined,
        offers: {
          "@type": "Offer",
          price: p.price.toFixed(2),
          priceCurrency: p.currency || "USD",
          availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          url: `${shopUrl}#p-${p.id}`,
          seller,
        },
      })),
    ],
  };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [data, base] = await Promise.all([loadShop(slug), appUrl()]);
  if (!data) notFound();
  const { shop, products } = data;
  // Escape "<" so product text can never close the script tag.
  const ld = JSON.stringify(jsonLd(shop, products, base)).replace(/</g, "\\u003c");

  return (
    <>
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <main>
        <section className="wrap pb-14 pt-14 sm:pt-20">
          <p className="eyebrow">{shop.location ? `Independent shop in ${shop.location}` : "Independent shop"}</p>
          <h1 className="display mt-4 text-[56px] sm:text-[88px]">{shop.name}</h1>
          {shop.tagline && <p className="mt-5 max-w-[46ch] text-[20px] leading-[1.45] text-ink/85">{shop.tagline}</p>}
          {shop.about && <p className="prose-measure mt-6 whitespace-pre-line text-ink/75">{shop.about}</p>}
          <p className="mt-8 border-l-2 border-accent pl-4 text-[15px]">
            Buy from this shop inside Claude:{" "}
            <Link href="/#connect" className="link">
              connect Shelf
            </Link>
            , then ask &ldquo;Use Shelf to find something from {shop.name}.&rdquo; You approve every payment in PayPal.
          </p>
        </section>

        <section className="wrap" aria-label="Products">
          {products.length === 0 ? (
            <p className="border-t border-line py-10 text-muted">This shop hasn&rsquo;t listed anything yet.</p>
          ) : (
            <ul className="border-t border-line">
              {products.map((p) => {
                const attrs = attrRows(p);
                // No photo: a text-led row with no empty image box.
                const hasImage = !!p.image_url;
                return (
                  <li
                    key={p.id}
                    id={`p-${p.id}`}
                    className={`grid scroll-mt-8 gap-6 border-b border-line py-10 sm:gap-10 ${
                      hasImage ? "sm:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr_260px]" : "lg:grid-cols-[1fr_260px]"
                    }`}
                  >
                    {hasImage && (
                      <div className="aspect-square w-full max-w-[320px] border border-line bg-surface">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image_url!} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                        <h2 className="display text-[32px] leading-[1.1] sm:text-[36px]">{p.title}</h2>
                        <p className="mono text-[16px]">{money(p.price, p.currency, { cents: !Number.isInteger(p.price) })}</p>
                      </div>
                      {p.stock <= 0 && <p className="mt-1 text-[13px] text-warn">Sold out</p>}
                      {p.description && <p className="prose-measure mt-4 text-ink/80">{p.description}</p>}
                      {p.tags?.length > 0 && (
                        <p className="mt-4 text-[13px] text-muted">{p.tags.slice(0, 10).join(", ")}</p>
                      )}
                    </div>

                    {attrs.length > 0 && (
                      <dl
                        className={`grid h-fit grid-cols-[96px_1fr] gap-x-4 gap-y-2 text-[14px] ${
                          hasImage ? "sm:col-start-2 lg:col-start-auto" : ""
                        }`}
                      >
                        {attrs.map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted">{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
