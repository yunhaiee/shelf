// Registers (or updates) the PayPal sandbox webhook for Shelf and prints its id for PAYPAL_WEBHOOK_ID.
// Run: npx tsx --env-file=.env scripts/register-webhook.mts [--url https://your-app.onrender.com]
import { appUrl, describePaypalError, paypalFetch, WEBHOOK_EVENTS } from "../lib/paypal.ts";

type Webhook = { id: string; url: string; event_types: { name: string }[] };

const argIdx = process.argv.indexOf("--url");
const base = (argIdx > -1 ? process.argv[argIdx + 1] : appUrl()).replace(/\/+$/, "");
const url = `${base}/api/paypal/webhook`;

if (!url.startsWith("https://")) {
  console.error(`PayPal only delivers webhooks to public HTTPS URLs; got ${url}.`);
  console.error("Set APP_URL to the deployed Render URL or pass --url https://<host>.");
  process.exit(1);
}

const wanted = [...WEBHOOK_EVENTS].sort();

try {
  const { webhooks = [] } = await paypalFetch<{ webhooks?: Webhook[] }>("/v1/notifications/webhooks");
  const existing = webhooks.find((w) => w.url.replace(/\/+$/, "") === url);

  let hook: Webhook;
  if (existing) {
    const have = existing.event_types.map((e) => e.name).sort();
    if (have.join() === wanted.join()) {
      hook = existing;
      console.log("Webhook already registered with the right events.");
    } else {
      hook = await paypalFetch<Webhook>(`/v1/notifications/webhooks/${existing.id}`, {
        method: "PATCH",
        body: [{ op: "replace", path: "/event_types", value: wanted.map((name) => ({ name })) }],
      });
      console.log(`Updated event types on existing webhook (was: ${have.join(", ") || "none"}).`);
    }
  } else {
    hook = await paypalFetch<Webhook>("/v1/notifications/webhooks", {
      method: "POST",
      body: { url, event_types: wanted.map((name) => ({ name })) },
    });
    console.log("Created webhook.");
  }

  console.log(`  url:    ${hook.url}`);
  console.log(`  events: ${hook.event_types.map((e) => e.name).join(", ")}`);
  console.log(`\nPAYPAL_WEBHOOK_ID=${hook.id}`);
  console.log("Add that line to .env and to the Render service's environment.");
} catch (err) {
  console.error("Webhook registration failed:", describePaypalError(err));
  process.exit(1);
}
