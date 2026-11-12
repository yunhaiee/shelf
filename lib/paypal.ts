// PayPal client for Shelf (sandbox). Orders v2 + Payments go through the APIMatic-generated
// @paypal/paypal-server-sdk; the few endpoints the SDK lacks (webhook signature verification,
// webhook registration) use paypalFetch() with the same cached OAuth token. Server-only.
import {
  ApiError,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  type ClientCredentialsAuthManager,
  type OAuthToken,
} from "@paypal/paypal-server-sdk";

export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

type Sdk = { client: Client; orders: OrdersController; payments: PaymentsController };

const g = globalThis as unknown as {
  __shelfPaypal?: Sdk;
  __shelfPaypalToken?: OAuthToken;
  __shelfPaypalTokenInflight?: Promise<OAuthToken> | null;
};

/** One OAuth token shared by the SDK and raw fetches; refreshed 60s before expiry. */
async function sharedToken(manager: ClientCredentialsAuthManager): Promise<OAuthToken> {
  const cur = g.__shelfPaypalToken;
  if (cur && manager.isValid(cur) && !manager.isExpired(cur)) return cur;
  g.__shelfPaypalTokenInflight ??= manager
    .fetchToken()
    .then((t) => (g.__shelfPaypalToken = t))
    .catch((err) => {
      // The SDK keeps a rejected token promise forever; drop the client so the next call starts clean.
      g.__shelfPaypal = undefined;
      throw new Error(`PayPal authentication failed: ${describePaypalError(err)}`);
    })
    .finally(() => (g.__shelfPaypalTokenInflight = null));
  return g.__shelfPaypalTokenInflight;
}

function makeSdk(): Sdk {
  const oAuthClientId = process.env.PAYPAL_CLIENT_ID;
  const oAuthClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!oAuthClientId || !oAuthClientSecret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  const client = new Client({
    environment: Environment.Sandbox,
    timeout: 20_000,
    clientCredentialsAuthCredentials: {
      oAuthClientId,
      oAuthClientSecret,
      oAuthClockSkew: 60,
      oAuthTokenProvider: (_last, manager) => sharedToken(manager),
    },
    // Every POST we make carries a PayPal-Request-Id, so retrying it is safe.
    httpClientOptions: {
      retryConfig: {
        maxNumberOfRetries: 2,
        retryOnTimeout: true,
        retryInterval: 1,
        maximumRetryWaitTime: 8,
        backoffFactor: 2,
        httpStatusCodesToRetry: [408, 429, 500, 502, 503, 504],
        httpMethodsToRetry: ["GET", "POST"],
      },
    },
  });
  return { client, orders: new OrdersController(client), payments: new PaymentsController(client) };
}

export function paypal(): Sdk {
  g.__shelfPaypal ??= makeSdk();
  return g.__shelfPaypal;
}

/** Bearer token for raw REST calls (same token the SDK uses). */
export async function getAccessToken(): Promise<string> {
  return (await sharedToken(paypal().client.clientCredentialsAuthManager)).accessToken;
}

/** Raw JSON call to a PayPal REST endpoint the SDK doesn't cover. Throws PaypalHttpError on non-2xx. */
export async function paypalFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: string | object; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const token = await getAccessToken();
  const body = init.body == null ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new PaypalHttpError(res.status, json);
  return json as T;
}

export class PaypalHttpError extends Error {
  constructor(
    public statusCode: number,
    public result: unknown,
  ) {
    super(`PayPal HTTP ${statusCode}`);
  }
}

type PaypalErrorBody = {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
  error?: string;
  error_description?: string;
};

function errorBody(err: unknown): PaypalErrorBody | null {
  if (err instanceof ApiError || err instanceof PaypalHttpError) {
    let r = err.result as unknown;
    if (r == null && err instanceof ApiError && typeof err.body === "string") {
      try {
        r = JSON.parse(err.body);
      } catch {
        /* not JSON */
      }
    }
    return r && typeof r === "object" ? (r as PaypalErrorBody) : null;
  }
  return null;
}

export function paypalStatusCode(err: unknown): number | null {
  return err instanceof ApiError || err instanceof PaypalHttpError ? err.statusCode : null;
}

/** PayPal `details[].issue` codes (e.g. ORDER_ALREADY_CAPTURED), plus the top-level `name`. */
export function paypalIssues(err: unknown): string[] {
  const b = errorBody(err);
  if (!b) return [];
  return [...(b.details ?? []).map((d) => d.issue).filter((x): x is string => !!x), ...(b.name ? [b.name] : [])];
}

/** Short human-readable description of any PayPal / network error (never includes secrets). */
export function describePaypalError(err: unknown): string {
  const b = errorBody(err);
  if (b) {
    const d = b.details?.[0];
    const what = d ? `${d.issue}${d.description ? `: ${d.description}` : ""}` : b.message || b.error_description || b.name || b.error;
    return `${what ?? "PayPal error"}${b.debug_id ? ` (debug id ${b.debug_id})` : ""}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- webhooks ----------

/** Verifies a webhook delivery with PayPal. `rawBody` must be the exact request body. */
export async function verifyWebhookSignature(headers: Headers, rawBody: string, webhookId: string): Promise<boolean> {
  const h = (k: string) => headers.get(k) ?? "";
  const fields = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
  };
  if (!fields.transmission_id || !fields.transmission_sig || !fields.cert_url) return false;
  // Splice the raw event bytes in instead of re-serializing, so the signed payload is untouched.
  const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
  const res = await paypalFetch<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body,
  });
  return res?.verification_status === "SUCCESS";
}

export const WEBHOOK_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.CAPTURE.DENIED",
] as const;

export function appUrl(): string {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/+$/, "");
}
