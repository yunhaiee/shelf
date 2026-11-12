// Sandbox smoke test for module A: temp shop+product -> createCheckout -> GET order from PayPal -> assertions -> cleanup.
// Run: npx tsx --env-file=.env scripts/test-paypal.mts [--keep]
//   --keep  leaves the temp shop/order in place so you can approve the printed link as the sandbox buyer
//           and then watch /paid, the webhook and check_order work end to end.
import { captureCheckout, createCheckout, getCheckoutStatus } from "../lib/checkout.ts";
import { describePaypalError, paypal } from "../lib/paypal.ts";
import { pool } from "../lib/db.ts";
import { createShop, deleteShopWithOrders, insertProducts, publishShop } from "../lib/repo.ts";

const keep = process.argv.includes("--keep");
const sellerEmail = process.env.SELLER_PAYPAL_EMAIL;
if (!sellerEmail) throw new Error("SELLER_PAYPAL_EMAIL is not set");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
async function expectError(label: string, fn: () => Promise<unknown>, match: RegExp) {
  try {
    await fn();
    check(label, false, "no error thrown");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, match.test(msg), msg);
  }
}

const shop = await createShop({
  name: `Shelf PayPal Test ${Date.now().toString(36)}`,
  about: "Temporary shop created by scripts/test-paypal.mts",
  paypal_email: sellerEmail,
  source_url: "test-paypal",
});
console.log(`temp shop ${shop.id} (${shop.slug})`);

try {
  // 28.10 x 3 is 84.30000000000001 in float math; the order must say exactly 84.30.
  const [product, soldOut] = await insertProducts(shop.id, [
    {
      title: "Speckled test mug",
      description: "Wheel-thrown stoneware mug with a speckled oatmeal glaze. Test product.",
      price: 28.1,
      currency: "USD",
      image_url: null,
      tags: ["test"],
      attributes: { material: "stoneware" },
      ai_fields: [],
      market_low: null,
      market_median: null,
      market_high: null,
      stock: 5,
    },
    {
      title: "Sold-out test bowl",
      description: null,
      price: 34,
      currency: "USD",
      image_url: null,
      tags: [],
      attributes: {},
      ai_fields: [],
      market_low: null,
      market_median: null,
      market_high: null,
      stock: 0,
    },
  ]);

  await expectError("draft shop is refused", () => createCheckout({ productId: product.id }), /isn't taking orders/);
  await publishShop(shop.id);

  await expectError("unknown product id is refused", () => createCheckout({ productId: "nope" }), /No product/);
  await expectError("quantity 0 is refused", () => createCheckout({ productId: product.id, qty: 0 }), /at least 1/);
  await expectError("out of stock is refused", () => createCheckout({ productId: soldOut.id }), /out of stock/);
  await expectError("qty above stock is refused", () => createCheckout({ productId: product.id, qty: 6 }), /Only 5/);

  const t0 = Date.now();
  const { order, approveUrl } = await createCheckout({
    productId: product.id,
    qty: 3,
    clientName: "test-paypal",
    query: "speckled mug under $30",
    giftNote: "Happy birthday!",
    shipToName: "Test Buyer",
  });
  console.log(`\ncreateCheckout ok in ${Date.now() - t0}ms`);
  console.log(`  shelf order:  ${order.id}`);
  console.log(`  paypal order: ${order.paypal_order_id}`);
  console.log(`  approve URL:  ${approveUrl}\n`);

  check("local order stored with PayPal id", !!order.paypal_order_id && order.status === "created", order.status);
  check("local amount is 84.30", order.amount === 84.3, String(order.amount));
  check("approve URL present", /^https:\/\/www\.sandbox\.paypal\.com\//.test(approveUrl), approveUrl);

  const pp = (await paypal().orders.getOrder({ id: order.paypal_order_id! })).result;
  const pu = pp.purchaseUnits?.[0];
  check("PayPal status CREATED / PAYER_ACTION_REQUIRED", pp.status === "CREATED" || pp.status === "PAYER_ACTION_REQUIRED", pp.status);
  check(
    "payee email = seller sandbox email",
    pu?.payee?.emailAddress?.toLowerCase() === sellerEmail.toLowerCase(),
    pu?.payee?.emailAddress === sellerEmail ? "match" : "mismatch",
  );
  check("amount exactly 84.30 USD", pu?.amount?.value === "84.30" && pu?.amount?.currencyCode === "USD", pu?.amount?.value);
  check("item_total breakdown 84.30", pu?.amount?.breakdown?.itemTotal?.value === "84.30");
  const item = pu?.items?.[0];
  check("item: qty 3 @ 28.10, PHYSICAL_GOODS", item?.quantity === "3" && item?.unitAmount?.value === "28.10" && item?.category === "PHYSICAL_GOODS");
  check("custom_id / reference_id = Shelf order id", pu?.customId === order.id && pu?.referenceId === order.id);

  const status = await getCheckoutStatus(order.id);
  check("getCheckoutStatus by Shelf id: still created", status?.order.status === "created", status?.order.status);
  const byPaypal = await getCheckoutStatus(order.paypal_order_id!);
  check("getCheckoutStatus by PayPal id resolves same order", byPaypal?.order.id === order.id);
  check("getCheckoutStatus unknown id -> null", (await getCheckoutStatus("00000000-0000-0000-0000-000000000000")) === null);

  await expectError("capture before approval explains itself", () => captureCheckout(order.paypal_order_id!), /hasn't approved/);

  if (keep) {
    console.log(`\n--keep: temp shop left in place. Approve as the sandbox buyer (${process.env.BUYER_PAYPAL_EMAIL}):`);
    console.log(`  ${approveUrl}`);
    console.log(`Then open ${process.env.APP_URL}/paid?order=${order.id} (or MCP check_order ${order.id}) to see it paid.`);
  }
} catch (err) {
  failures++;
  console.error("\nUNEXPECTED ERROR:", describePaypalError(err));
} finally {
  if (!keep) {
    await deleteShopWithOrders(shop.id);
    console.log("\ncleaned up temp shop, product and orders");
  }
  await pool().end();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
