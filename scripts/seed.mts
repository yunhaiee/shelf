// Seed the Shelf network with demo data so it looks lived-in.
//   npx tsx --env-file=.env scripts/seed.mts                         idempotent: safe to re-run
//   npx tsx --env-file=.env scripts/seed.mts --reset-demo   first delete "Hanul Clay" (+ its orders), demo-session shops
//                                                            and non-seed searches from the last 24h, to re-record the demo
//
// Seeds 4 fictional published shops (none sell ceramics, so the demo search only matches Hanul Clay after it
// publishes) and ~40 agent search-log rows over the past 7 days. ALL OF THIS IS DEMO DATA.
// Seed shops are marked source_url = 'seed'; seed search rows get fixed ids (5eed0000-…) so re-runs update
// them in place instead of duplicating. Each run also re-anchors seed timestamps relative to "now".
import { query, queryOne, pool } from "../lib/db.ts";
import { createShop, insertProducts, listProducts, logSearch, publishShop, updateShop } from "../lib/repo.ts";
import type { DraftProduct, ProductAttributes } from "../lib/types.ts";

const args = new Set(process.argv.slice(2));
const RESET_DEMO = args.has("--reset-demo");
const unknown = [...args].filter((a) => a !== "--reset-demo");
if (unknown.length) {
  console.error(`Unknown flag(s): ${unknown.join(", ")}. The only flag is --reset-demo.`);
  process.exit(1);
}

const SELLER_EMAIL = process.env.SELLER_PAYPAL_EMAIL;
if (!SELLER_EMAIL) {
  console.error("SELLER_PAYPAL_EMAIL is not set (seed shops are paid to the sandbox seller account).");
  process.exit(1);
}
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

// ---------- tiny SVG product thumbnails (data URIs) ----------

const svgUri = (inner: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#f1eadf"/><ellipse cx="100" cy="168" rx="62" ry="8" fill="#5c4632" opacity=".18"/>${inner}</svg>`);

const flame = (x: number, y: number) =>
  `<path d="M${x} ${y - 16}c6 7 7 12 0 16c-7-4-6-9 0-16z" fill="#e7a447"/><path d="M${x} ${y - 9}c3 3 3 6 0 8c-3-2-3-5 0-8z" fill="#fbe3a1"/>`;

const img = {
  jar: (glass: string, wax: string) =>
    svgUri(`<rect x="62" y="70" width="76" height="98" rx="10" fill="${glass}"/><ellipse cx="100" cy="74" rx="34" ry="7" fill="${wax}"/><rect x="74" y="104" width="52" height="36" rx="2" fill="#f6efe3"/><rect x="82" y="116" width="36" height="3" fill="${glass}" opacity=".7"/><rect x="86" y="124" width="28" height="2" fill="${glass}" opacity=".5"/><rect x="99" y="58" width="2" height="14" fill="#3a2c22"/>${flame(100, 58)}`),
  tapers: () =>
    svgUri(`<rect x="76" y="56" width="14" height="112" rx="3" fill="#e9c46a"/><rect x="110" y="56" width="14" height="112" rx="3" fill="#e2b85a"/><rect x="82" y="46" width="2" height="10" fill="#3a2c22"/><rect x="116" y="46" width="2" height="10" fill="#3a2c22"/>${flame(83, 46)}${flame(117, 46)}`),
  tins: () =>
    svgUri(["#9aa58a", "#c9a27c", "#8fa9b5"].map((c, i) => `<ellipse cx="${56 + i * 44}" cy="${128 - (i % 2) * 6}" rx="22" ry="8" fill="#6b5c4c"/><rect x="${34 + i * 44}" y="${104 - (i % 2) * 6}" width="44" height="24" fill="${c}"/><ellipse cx="${56 + i * 44}" cy="${104 - (i % 2) * 6}" rx="22" ry="8" fill="#d8d2c6"/>`).join("")),
  linen: (c: string, stripe: string) =>
    svgUri(`<rect x="48" y="124" width="104" height="22" rx="4" fill="${c}" opacity=".85"/><rect x="44" y="104" width="112" height="22" rx="4" fill="${c}"/><rect x="44" y="112" width="112" height="3" fill="${stripe}"/><rect x="52" y="84" width="96" height="22" rx="4" fill="${c}" opacity=".92"/><rect x="52" y="92" width="96" height="3" fill="${stripe}"/><rect x="48" y="146" width="104" height="22" rx="4" fill="${c}" opacity=".75"/>`),
  bag: (c: string, label: string) =>
    svgUri(`<path d="M64 62h72l8 106H56z" fill="${c}"/><path d="M64 62h72v10H64z" fill="#000" opacity=".12"/><rect x="74" y="94" width="52" height="48" rx="2" fill="${label}"/><circle cx="100" cy="110" r="8" fill="${c}" opacity=".85"/><rect x="84" y="124" width="32" height="3" fill="${c}" opacity=".6"/><rect x="90" y="131" width="20" height="2" fill="${c}" opacity=".4"/>`),
  card: (c: string, motif: string) =>
    svgUri(`<rect x="44" y="76" width="112" height="84" rx="2" fill="#e4d8c6" transform="rotate(-6 100 118)"/><rect x="56" y="60" width="92" height="108" rx="2" fill="#fbf8f2"/><circle cx="102" cy="104" r="20" fill="none" stroke="${c}" stroke-width="3"/><path d="M102 86c8 10 8 26 0 36c-8-10-8-26 0-36z" fill="${motif}"/><rect x="78" y="136" width="48" height="3" fill="${c}"/><rect x="86" y="144" width="32" height="2" fill="${c}" opacity=".6"/>`),
};

// ---------- seed shops (fictional) ----------

type SeedProduct = { title: string; price: number; description: string; tags: string[]; attributes: ProductAttributes; stock: number; image_url: string | null };
type SeedShop = {
  name: string; tagline: string; about: string; location: string;
  publishedDaysAgo: number;
  products: SeedProduct[];
};

const SHOPS: SeedShop[] = [
  {
    name: "Fernwick Candle Co.",
    tagline: "Hand-poured soy candles in small batches.",
    about: "Two friends pouring soy and beeswax candles in a shared workshop in Portland. Scents are blended in-house with phthalate-free oils; jars are reusable amber glass.",
    location: "Portland, OR",
    publishedDaysAgo: 34,
    products: [
      { title: "Cedar & Smoke Soy Candle", price: 32, stock: 24, image_url: img.jar("#8a5a2b", "#efe4cf"),
        description: "Our best seller: cedarwood, vetiver and a little campfire smoke. 8 oz of soy wax in a reusable amber glass jar with a cotton wick.",
        tags: ["candle", "soy wax", "woodsy", "cedar", "hand-poured", "gift", "cozy", "home fragrance"],
        attributes: { material: "soy wax, amber glass jar", color: "amber", capacity: "8 oz", dimensions: "3 x 3.5 in", care: "Trim wick to 1/4 in before each burn; burn 2–3 hours at a time.", handmade: true, burn_time: "about 50 hours" } },
      { title: "Fig Leaf Soy Candle", price: 32, stock: 18, image_url: img.jar("#7a6a3a", "#f1e9d6"),
        description: "Green fig, crushed leaves and a soft woody base. Bright without being sweet. 8 oz amber jar, roughly 50 hours of burn time.",
        tags: ["candle", "soy wax", "fig", "fresh", "hand-poured", "housewarming gift", "gift", "home fragrance"],
        attributes: { material: "soy wax, amber glass jar", color: "amber", capacity: "8 oz", dimensions: "3 x 3.5 in", care: "Trim wick to 1/4 in before each burn.", handmade: true, burn_time: "about 50 hours" } },
      { title: "Sea Salt & Sage Candle, 12 oz", price: 42, stock: 9, image_url: img.jar("#6b7f7a", "#eef0ea"),
        description: "Coastal sage, sea salt and driftwood in our larger double-wick jar. Fills a living room.",
        tags: ["candle", "soy wax", "sage", "sea salt", "double wick", "large candle", "gift", "home fragrance"],
        attributes: { material: "soy wax, glass jar", color: "smoke green", capacity: "12 oz", dimensions: "3.5 x 4 in", care: "Burn until the wax pool reaches the edge; trim wicks.", handmade: true, burn_time: "about 70 hours" } },
      { title: "Beeswax Taper Candles, pair", price: 18, stock: 40, image_url: img.tapers(),
        description: "Two hand-dipped 100% beeswax tapers. Naturally honey-scented, slow and nearly dripless. Fit standard holders.",
        tags: ["candle", "beeswax", "taper candles", "unscented", "dinner table", "natural", "hand-dipped", "gift"],
        attributes: { material: "100% beeswax, cotton wick", color: "natural honey", dimensions: "10 in tall, 7/8 in base", care: "Keep away from drafts; trim wick to 1/4 in.", handmade: true, burn_time: "about 10 hours each" } },
      { title: "Travel Tin Candle Trio", price: 28, stock: 15, image_url: img.tins(),
        description: "Three 2 oz tins: Cedar & Smoke, Fig Leaf and Sea Salt & Sage. Good for small rooms, travel, or trying scents.",
        tags: ["candle", "travel candle", "gift set", "sampler", "soy wax", "stocking stuffer", "small gift", "tins"],
        attributes: { material: "soy wax, tin", capacity: "3 x 2 oz", dimensions: "2.5 in tins", care: "Burn 1–2 hours at a time.", handmade: true } },
    ],
  },
  {
    name: "Slow Thread Linen Works",
    tagline: "Handwoven and washed linen for the table and home.",
    about: "A two-loom weaving studio in Asheville. We weave European flax linen into towels, napkins and runners, then wash every piece so it arrives soft.",
    location: "Asheville, NC",
    publishedDaysAgo: 21,
    products: [
      { title: "Washed Linen Tea Towel", price: 24, stock: 30, image_url: img.linen("#d9cbb3", "#9b6a47"),
        description: "Absorbent, quick-drying kitchen towel in washed linen with a rust stripe. Gets softer every wash.",
        tags: ["linen", "tea towel", "kitchen", "natural fiber", "washed linen", "hostess gift", "gift", "handwoven"],
        attributes: { material: "100% European flax linen", color: "oat with rust stripe", dimensions: "18 x 28 in", care: "Machine wash warm, tumble dry low.", handmade: true } },
      { title: "Linen Napkins, set of 4", price: 48, stock: 20, image_url: img.linen("#c9d1c3", "#6f7a5c"),
        description: "Four washed linen napkins with mitered corners, in sage. Made for everyday dinners, not just holidays.",
        tags: ["linen", "napkins", "table linen", "dinner party", "natural fiber", "set of 4", "gift", "washed linen"],
        attributes: { material: "100% linen", color: "sage", dimensions: "18 x 18 in each", care: "Machine wash warm; line or tumble dry.", handmade: true } },
      { title: "Handwoven Linen Table Runner", price: 68, stock: 8, image_url: img.linen("#e6dccb", "#3b3029"),
        description: "Woven on our floor loom in a subtle herringbone with fringed ends. Works on a dining table or a long sideboard.",
        tags: ["linen", "table runner", "handwoven", "herringbone", "dining table", "home decor", "wedding gift", "natural fiber"],
        attributes: { material: "100% linen", color: "natural with charcoal", dimensions: "14 x 72 in", care: "Hand wash cold, lay flat to dry, warm iron.", handmade: true } },
      { title: "Waffle Weave Linen Bath Towel", price: 72, stock: 12, image_url: img.linen("#efe9df", "#c9b79c"),
        description: "Light, fast-drying waffle-weave bath towel. Takes up a fraction of the space of terry and dries in hours.",
        tags: ["linen", "bath towel", "waffle weave", "bathroom", "quick dry", "natural fiber", "gift", "washed linen"],
        attributes: { material: "linen and cotton blend", color: "natural white", dimensions: "27 x 55 in", care: "Machine wash warm, tumble dry low.", handmade: false } },
      { title: "Linen Cross-Back Apron", price: 58, stock: 14, image_url: img.linen("#8f7a63", "#e6dccb"),
        description: "No-tie cross-back apron with two deep pockets. Heavyweight washed linen in walnut, one size.",
        tags: ["linen", "apron", "kitchen", "baking", "cross-back", "gift for cook", "workwear", "washed linen"],
        attributes: { material: "heavyweight linen", color: "walnut", dimensions: "one size, 34 in long", care: "Machine wash cold, line dry.", handmade: true } },
    ],
  },
  {
    name: "Morning Ridge Coffee Roasters",
    tagline: "Small-batch coffee, roasted to order on the coast.",
    about: "A 12-kilo roaster in a Santa Cruz garage. We roast twice a week and ship within a day of roasting, whole bean only.",
    location: "Santa Cruz, CA",
    publishedDaysAgo: 48,
    products: [
      { title: "Ridge House Blend, 12 oz", price: 17, stock: 60, image_url: img.bag("#5b4636", "#efe4cf"),
        description: "Our daily drinker: milk chocolate, toasted almond, a little cherry. Medium roast, great as drip or French press.",
        tags: ["coffee", "whole bean", "medium roast", "house blend", "chocolate notes", "small batch", "roasted to order", "gift"],
        attributes: { material: "coffee beans (Brazil, Colombia)", roast: "medium", weight: "12 oz", grind: "whole bean", care: "Store airtight, away from light; best within 4 weeks of roast." } },
      { title: "Ethiopia Guji Natural, 12 oz", price: 21, stock: 30, image_url: img.bag("#9b6a47", "#f6efe3"),
        description: "Single origin, natural process. Blueberry, jasmine and dark chocolate. Light roast for pour-over.",
        tags: ["coffee", "single origin", "ethiopia", "light roast", "natural process", "pour-over", "fruity", "whole bean"],
        attributes: { material: "coffee beans", origin: "Guji, Ethiopia", process: "natural", roast: "light", weight: "12 oz", grind: "whole bean" } },
      { title: "Colombia Huila Decaf, 12 oz", price: 19, stock: 25, image_url: img.bag("#6f7a5c", "#f1eadf"),
        description: "Sugarcane-process decaf that still tastes like coffee: caramel, red apple, cocoa.",
        tags: ["coffee", "decaf", "sugarcane decaf", "colombia", "medium roast", "evening coffee", "whole bean", "single origin"],
        attributes: { material: "coffee beans", origin: "Huila, Colombia", process: "sugarcane (EA) decaf", roast: "medium", weight: "12 oz", grind: "whole bean" } },
      { title: "Night Shift Dark Roast, 12 oz", price: 18, stock: 35, image_url: img.bag("#2f2622", "#d9cbb3"),
        description: "Dark and syrupy without the burnt taste: molasses, cocoa nib, smoke. Holds up to milk.",
        tags: ["coffee", "dark roast", "bold", "whole bean", "molasses notes", "small batch", "milk drinks", "roasted to order"],
        attributes: { material: "coffee beans (Sumatra, Brazil)", roast: "dark", weight: "12 oz", grind: "whole bean" } },
      { title: "Roaster's Sampler, 3 x 4 oz", price: 24, stock: 20, image_url: img.bag("#8a5a2b", "#efe9df"),
        description: "Three 4 oz bags of whatever we're most excited about this week, with tasting notes. A good gift for a coffee person.",
        tags: ["coffee", "sampler", "gift set", "gift for dad", "coffee lover gift", "whole bean", "variety", "small batch"],
        attributes: { material: "coffee beans", weight: "3 x 4 oz", grind: "whole bean" } },
    ],
  },
  {
    name: "Inkwell & Ash Letterpress",
    tagline: "Cards and paper goods printed on a 1920s press.",
    about: "Hand-set type and polymer plates printed one sheet at a time on a Chandler & Price platen press in Providence. Cotton paper, envelopes included.",
    location: "Providence, RI",
    publishedDaysAgo: 15,
    products: [
      { title: "Thank You Letterpress Card", price: 6, stock: 80, image_url: img.card("#9b6a47", "#c9a27c"),
        description: "A simple 'thank you' in deep rust ink on soft cotton paper with a kraft envelope. Blank inside.",
        tags: ["card", "thank you card", "letterpress", "stationery", "cotton paper", "blank inside", "small gift", "note card"],
        attributes: { material: "100% cotton paper, kraft envelope", color: "rust ink on cream", dimensions: "A2, 4.25 x 5.5 in", handmade: true } },
      { title: "Birthday Card, Hand-Set Type", price: 6, stock: 70, image_url: img.card("#3b47a8", "#8fa9b5"),
        description: "'Happy birthday' set by hand in vintage wood type, printed in indigo. Blank inside with a white envelope.",
        tags: ["card", "birthday card", "letterpress", "wood type", "stationery", "blank inside", "handmade card", "gift"],
        attributes: { material: "100% cotton paper", color: "indigo on white", dimensions: "A2, 4.25 x 5.5 in", handmade: true } },
      { title: "Botanical Notecards, set of 8", price: 22, stock: 25, image_url: img.card("#6f7a5c", "#9aa58a"),
        description: "Eight blank notecards with four pressed-fern designs in moss and sage, plus envelopes in a cotton band.",
        tags: ["notecards", "stationery set", "botanical", "letterpress", "blank cards", "gift", "fern", "set of 8"],
        attributes: { material: "cotton paper", color: "moss and sage", dimensions: "A2 cards", handmade: true } },
      { title: "Wedding Thank-You Set, 12 cards", price: 36, stock: 15, image_url: img.card("#8a5a2b", "#e8bba5"),
        description: "Twelve letterpress thank-you cards in blush and rust, sized for a short handwritten note.",
        tags: ["wedding", "thank you cards", "letterpress", "stationery set", "blush", "set of 12", "bride gift", "cotton paper"],
        attributes: { material: "cotton paper, blush envelopes", color: "rust and blush", dimensions: "A2 cards", handmade: true } },
      { title: "2027 Letterpress Wall Calendar", price: 34, stock: 18, image_url: img.card("#3b3029", "#d9cbb3"),
        description: "Twelve months printed in two colors, one botanical per month. Hangs from a brass clip; pages make good postcards after.",
        tags: ["calendar", "2027 calendar", "wall calendar", "letterpress", "botanical", "office decor", "gift", "stationery"],
        attributes: { material: "cotton paper, brass clip", color: "two-color", dimensions: "8 x 10 in", handmade: true } },
    ],
  },
];

// ---------- seed agent searches (network demand), past 7 days ----------

type SeedSearch = { q: string; max: number | null; client: "Claude" | "AI agent"; hoursAgo: number; market: number; hit?: string; hits?: number };

const SEARCHES: SeedSearch[] = [
  // ceramics: nobody on Shelf sells these yet (this is the demand Hanul Clay walks into)
  { q: "speckled ceramic mug gift", max: 40, client: "Claude", hoursAgo: 2, market: 8 },
  { q: "handmade stoneware bowl", max: null, client: "AI agent", hoursAgo: 5, market: 8 },
  { q: "speckled bowl", max: null, client: "Claude", hoursAgo: 9, market: 8 },
  { q: "small studio ceramics under $40", max: 40, client: "Claude", hoursAgo: 14, market: 7 },
  { q: "celadon cup", max: null, client: "AI agent", hoursAgo: 20, market: 6 },
  { q: "speckled bowl for ramen", max: 45, client: "AI agent", hoursAgo: 26, market: 8 },
  { q: "handmade mug from a small studio", max: 40, client: "Claude", hoursAgo: 31, market: 8 },
  { q: "speckled bowl", max: 50, client: "Claude", hoursAgo: 38, market: 8 },
  { q: "celadon tea cup handmade", max: null, client: "AI agent", hoursAgo: 44, market: 5 },
  { q: "pottery gift for my sister under $50", max: 50, client: "Claude", hoursAgo: 52, market: 8 },
  { q: "handmade bud vase", max: 30, client: "AI agent", hoursAgo: 60, market: 7 },
  { q: "speckled ceramic mug gift", max: null, client: "AI agent", hoursAgo: 70, market: 8 },
  { q: "handmade stoneware bowl", max: 40, client: "Claude", hoursAgo: 80, market: 8 },
  { q: "speckled bowl set of two", max: 80, client: "Claude", hoursAgo: 95, market: 6 },
  { q: "espresso cups handmade pair", max: 45, client: "AI agent", hoursAgo: 110, market: 7 },
  { q: "small batch pottery mug", max: 35, client: "Claude", hoursAgo: 130, market: 8 },
  { q: "handmade serving platter", max: null, client: "AI agent", hoursAgo: 150, market: 6 },
  { q: "speckled bowl", max: null, client: "AI agent", hoursAgo: 160, market: 8 },
  { q: "ceramic pour over coffee dripper", max: 45, client: "Claude", hoursAgo: 165, market: 8 },
  { q: "hand-thrown planter with drainage", max: 60, client: "Claude", hoursAgo: 7, market: 6 },
  // served by the seed shops
  { q: "soy candle gift under $35", max: 35, client: "Claude", hoursAgo: 3, market: 8, hit: "Cedar & Smoke Soy Candle", hits: 3 },
  { q: "beeswax taper candles", max: null, client: "AI agent", hoursAgo: 12, market: 6, hit: "Beeswax Taper Candles, pair", hits: 1 },
  { q: "linen napkins set", max: 60, client: "Claude", hoursAgo: 18, market: 8, hit: "Linen Napkins, set of 4", hits: 2 },
  { q: "linen apron for a baker", max: null, client: "Claude", hoursAgo: 29, market: 7, hit: "Linen Cross-Back Apron", hits: 1 },
  { q: "whole bean coffee from a small roaster", max: 25, client: "AI agent", hoursAgo: 34, market: 8, hit: "Ridge House Blend, 12 oz", hits: 4 },
  { q: "decaf coffee beans", max: null, client: "AI agent", hoursAgo: 47, market: 8, hit: "Colombia Huila Decaf, 12 oz", hits: 1 },
  { q: "letterpress thank you cards", max: null, client: "Claude", hoursAgo: 56, market: 6, hit: "Thank You Letterpress Card", hits: 2 },
  { q: "handmade birthday card", max: 10, client: "AI agent", hoursAgo: 66, market: 7, hit: "Birthday Card, Hand-Set Type", hits: 1 },
  { q: "housewarming gift under $40", max: 40, client: "Claude", hoursAgo: 75, market: 8, hit: "Fig Leaf Soy Candle", hits: 3 },
  { q: "linen tea towel", max: 30, client: "Claude", hoursAgo: 88, market: 8, hit: "Washed Linen Tea Towel", hits: 1 },
  { q: "coffee gift for dad", max: 30, client: "AI agent", hoursAgo: 100, market: 8, hit: "Roaster's Sampler, 3 x 4 oz", hits: 2 },
  { q: "wedding thank you cards letterpress", max: null, client: "Claude", hoursAgo: 120, market: 5, hit: "Wedding Thank-You Set, 12 cards", hits: 1 },
  { q: "natural fiber bath towel", max: 80, client: "AI agent", hoursAgo: 140, market: 7, hit: "Waffle Weave Linen Bath Towel", hits: 1 },
  { q: "2027 wall calendar", max: 40, client: "Claude", hoursAgo: 155, market: 8, hit: "2027 Letterpress Wall Calendar", hits: 1 },
  { q: "travel candle set", max: 30, client: "AI agent", hoursAgo: 162, market: 6, hit: "Travel Tin Candle Trio", hits: 1 },
  // other unmet demand
  { q: "wool throw blanket handwoven", max: 150, client: "AI agent", hoursAgo: 40, market: 8 },
  { q: "small batch hot sauce gift set", max: 40, client: "AI agent", hoursAgo: 85, market: 8 },
  { q: "hand-bound leather notebook", max: 50, client: "Claude", hoursAgo: 105, market: 7 },
  { q: "unscented natural soap bar", max: 15, client: "AI agent", hoursAgo: 125, market: 8 },
  { q: "handmade wooden cutting board", max: 80, client: "Claude", hoursAgo: 145, market: 8 },
  // pour-over drippers: unmet ceramic demand that closes the demo (append-only: ids are by array index)
  { q: "handmade pour over coffee dripper", max: 50, client: "Claude", hoursAgo: 4, market: 8 },
  { q: "ceramic pour over cone gift", max: 45, client: "AI agent", hoursAgo: 23, market: 7 },
  { q: "stoneware coffee dripper small studio", max: null, client: "Claude", hoursAgo: 49, market: 6 },
  { q: "pour over dripper and mug set handmade", max: 80, client: "Claude", hoursAgo: 72, market: 7 },
  { q: "handmade coffee dripper", max: 40, client: "AI agent", hoursAgo: 101, market: 8 },
];

const seedSearchId = (i: number) => `5eed0000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`;
const SEED_ID_PREFIX = "5eed0000-0000-4000-8000-";

// ---------- steps ----------

async function resetDemo() {
  // 1) Hanul Clay (the demo seller) and 2) any demo-session shops judges created via the try-it flow.
  const hanul = await query<{ id: string; slug: string }>(
    `select id, slug from shops
      where coalesce(source_url, '') <> 'seed'
        and (lower(name) like 'hanul clay%' or slug ~ '^hanul-clay(-[0-9]+)?$')`,
  );
  // shops.demo_session is added by a separate migration; only use it if the column exists.
  const hasDemoSession = !!(await queryOne(
    `select 1 from information_schema.columns
      where table_schema = current_schema() and table_name = 'shops' and column_name = 'demo_session'`,
  ));
  const sessionShops = hasDemoSession
    ? await query<{ id: string; slug: string }>(
        `select id, slug from shops where demo_session is not null and coalesce(source_url, '') <> 'seed'`,
      )
    : [];

  const byId = new Map([...hanul, ...sessionShops].map((s) => [s.id, s]));
  const ids = [...byId.keys()];
  let orders = 0;
  let answered = 0;
  if (ids.length) {
    // Order matters: orders.product_id is ON DELETE RESTRICT, so orders go before the shop cascade.
    orders = (await query(`delete from orders where shop_id = any($1::uuid[]) returning id`, [ids])).length;
    // Rehearsal searches these shops answered would otherwise linger in the demand grid.
    answered = (await query(
      `delete from searches where top_product_id in (select id from products where shop_id = any($1::uuid[])) returning id`,
      [ids],
    )).length;
    await query(`delete from shops where id = any($1::uuid[])`, [ids]);
  }
  // 3) Rehearsal / judge searches from the last 24h (seed rows have fixed 5eed… ids and are kept).
  const recent = await query(
    `delete from searches where id::text not like $1 and created_at > now() - interval '24 hours' returning id`,
    [`${SEED_ID_PREFIX}%`],
  );
  console.log(
    `reset-demo: deleted ${hanul.length} Hanul Clay shop(s)` +
      (hanul.length ? ` [${hanul.map((s) => s.slug).join(", ")}]` : "") +
      `, ${hasDemoSession ? `${sessionShops.length} demo-session shop(s)` : "demo-session: column not present, skipped"}` +
      `, ${orders} order(s), ${answered} search row(s) they answered, ${recent.length} non-seed search row(s) from the last 24h`,
  );
}

async function seedShop(s: SeedShop) {
  let row = await queryOne<{ id: string }>(`select id from shops where source_url = 'seed' and name = $1 order by created_at limit 1`, [s.name]);
  let created = false;
  if (!row) {
    const shop = await createShop({ name: s.name, tagline: s.tagline, about: s.about, location: s.location, paypal_email: SELLER_EMAIL, source_url: "seed" });
    row = { id: shop.id };
    created = true;
  } else {
    await updateShop(row.id, { tagline: s.tagline, about: s.about, location: s.location, paypal_email: SELLER_EMAIL });
  }

  const existing = new Set((await listProducts(row.id)).map((p) => p.title));
  const missing: DraftProduct[] = s.products
    .filter((p) => !existing.has(p.title))
    .map((p) => ({
      title: p.title, description: p.description, price: p.price, currency: "USD", image_url: p.image_url,
      tags: p.tags, attributes: p.attributes, ai_fields: [], market_low: null, market_median: null, market_high: null, stock: p.stock,
    }));
  if (missing.length) await insertProducts(row.id, missing);

  await publishShop(row.id);
  // Seed shops have been on Shelf for weeks; a fresh published_at would read as "published 2 minutes ago" to agents.
  const days = s.publishedDaysAgo;
  await query(
    `update shops set created_at = now() - make_interval(days => $2::int + 2), published_at = now() - make_interval(days => $2::int)
      where id = $1 and source_url = 'seed'`,
    [row.id, days],
  );
  await query(
    `update products set created_at = now() - make_interval(days => $2::int + 1), updated_at = now() - make_interval(days => $2::int + 1)
      where shop_id = $1 and created_at > now() - make_interval(days => $2::int)`,
    [row.id, days],
  );

  const shop = (await queryOne<{ id: string; slug: string; edit_token: string }>(`select id, slug, edit_token from shops where id = $1`, [row.id]))!;
  const products = await listProducts(row.id);
  return { ...shop, name: s.name, created, inserted: missing.length, total: products.length, products };
}

async function seedSearches(productIdByTitle: Map<string, string>) {
  const ids = SEARCHES.map((_, i) => seedSearchId(i));
  const have = new Set((await query<{ id: string }>(`select id from searches where id = any($1::uuid[])`, [ids])).map((r) => r.id));
  const { now: runStart } = (await queryOne<{ now: string }>(`select now()::text as now`))!;

  let inserted = 0;
  for (const [i, s] of SEARCHES.entries()) {
    const id = seedSearchId(i);
    const top = s.hit ? productIdByTitle.get(s.hit) ?? null : null;
    if (s.hit && !top) throw new Error(`seed search "${s.q}" points at unknown product "${s.hit}"`);
    const minutesAgo = s.hoursAgo * 60 + ((i * 17) % 50);

    if (!have.has(id)) {
      await logSearch({ query: s.q, max_price: s.max, client_name: s.client, shelf_hit_count: top ? s.hits ?? 1 : 0, market_hit_count: s.market, top_product_id: top });
      // logSearch doesn't return the row, so claim the newest matching row written during this run.
      const claimed = await query(
        `update searches set id = $1 where id = (
            select id from searches where query = $2 and client_name = $3 and created_at >= $4::timestamptz
               and id::text not like $5 order by created_at desc limit 1)
          returning id`,
        [id, s.q, s.client, runStart, `${SEED_ID_PREFIX}%`],
      );
      if (claimed.length !== 1) throw new Error(`could not claim inserted search row for "${s.q}"`);
      inserted++;
    }
    // Backdate (and re-anchor on every run so the log always spans the past 7 days).
    await query(
      `update searches set created_at = now() - make_interval(mins => $2::int), top_product_id = $3,
              shelf_hit_count = $4, market_hit_count = $5, max_price = $6, client_name = $7
        where id = $1`,
      [id, minutesAgo, top, top ? s.hits ?? 1 : 0, s.market, s.max, s.client],
    );
  }
  return { inserted, total: SEARCHES.length };
}

// ---------- main ----------

try {
  if (RESET_DEMO) await resetDemo();

  const productIdByTitle = new Map<string, string>();
  console.log("\nSeed shops (DEMO DATA, fictional):");
  for (const s of SHOPS) {
    const r = await seedShop(s);
    for (const p of r.products) productIdByTitle.set(p.title, p.id);
    console.log(
      `  ${r.created ? "created " : "exists  "} ${r.name.padEnd(32)} ${r.total} products (${r.inserted} new)\n` +
        `           public  ${APP_URL}/s/${r.slug}\n` +
        `           dash    ${APP_URL}/dash/${r.id}\n` +
        `           token   ${r.edit_token}`,
    );
  }

  const se = await seedSearches(productIdByTitle);
  console.log(`\nSeed searches: ${se.total} rows over the past 7 days (${se.inserted} new, rest re-anchored)`);

  const counts = (await queryOne<{ shops: string; products: string; searches: string; seed_searches: string; hanul: string }>(
    `select (select count(*) from shops where source_url = 'seed') as shops,
            (select count(*) from products p join shops s on s.id = p.shop_id where s.source_url = 'seed') as products,
            (select count(*) from searches) as searches,
            (select count(*) from searches where id::text like $1) as seed_searches,
            (select count(*) from shops where lower(name) like 'hanul clay%' and coalesce(source_url,'') <> 'seed') as hanul`,
    [`${SEED_ID_PREFIX}%`],
  ))!;
  console.log(
    `\nTotals: ${counts.shops} seed shops, ${counts.products} seed products, ${counts.seed_searches} seed searches ` +
      `(${counts.searches} searches total), Hanul Clay shops present: ${counts.hanul}`,
  );
} catch (err) {
  console.error("seed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool().end();
}
