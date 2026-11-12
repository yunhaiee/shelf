"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftProduct, Product, Shop } from "@/lib/types";
import { api, ApiError, errorMessage, saveToken } from "@/components/api";
import { CopyButton } from "@/components/CopyButton";
import { hostOf, money } from "@/components/format";
import { CatalogGrid, clearAiField, type CatalogEdit, type CatalogRow } from "@/components/grid/CatalogGrid";

// ---------- types + helpers ----------

type ShopForm = {
  name: string;
  tagline: string;
  about: string;
  location: string;
  paypal_email: string;
  source_url: string | null;
};

type ImportResult = {
  shop: { name?: string | null; tagline?: string | null; about?: string | null; location?: string | null };
  products: DraftProduct[];
};

type Phase = "input" | "importing" | "review" | "resuming";

const EMPTY_FORM: ShopForm = { name: "", tagline: "", about: "", location: "", paypal_email: "", source_url: null };

// Import progress lines, driven by the server's real stage events (POST /api/import, NDJSON).
const STAGES = ["Reading your shop", "Writing agent-ready details", "Checking market prices with Channel3"] as const;
const STAGE_INDEX = { read: 0, write: 1, prices: 2 } as const;
// A stage that finishes faster than this stays on screen this long, so every real step is readable.
const MIN_STAGE_MS = 650;

type StageEvent = { stage: "read" } | { stage: "write" } | { stage: "prices"; done: number; total: number };

/**
 * Shows stages in the order the server reports them, each for at least `minMs`. It never runs ahead of the
 * server: `reach(i)` is only called on a real event, and `done()` steps through what's left once the result
 * is in, then resolves.
 */
function createStageDriver(onShow: (i: number) => void, minMs: number) {
  const last = STAGES.length - 1;
  let shown = 0;
  let target = 0;
  let shownAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finish: (() => void) | null = null;

  const pump = () => {
    if (timer || (shown >= target && !finish)) return;
    const wait = shownAt + minMs - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, wait);
      return;
    }
    if (shown < target) {
      shown += 1;
      shownAt = Date.now();
      onShow(shown);
      pump();
      return;
    }
    const f = finish!;
    finish = null;
    f();
  };

  onShow(0);
  return {
    reach(i: number) {
      target = Math.max(target, Math.min(i, last));
      pump();
    },
    done() {
      target = last;
      return new Promise<void>((resolve) => {
        finish = resolve;
        pump();
      });
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      const f = finish;
      finish = null;
      f?.();
    },
  };
}

/** POST /api/import with streamed progress. Falls back to a plain JSON body if the server sends one. */
async function importWithProgress(
  body: { url?: string; text?: string },
  signal: AbortSignal,
  onStage: (e: StageEvent) => void,
): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Can't reach Shelf. Check your connection and try again.", 0);
  }

  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (!res.ok) {
      const msg = (data as { error?: unknown } | null)?.error;
      throw new ApiError(typeof msg === "string" && msg ? msg : `Import failed (${res.status}).`, res.status);
    }
    return data as ImportResult;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: { type?: string; error?: unknown; status?: unknown } & Partial<ImportResult> & Partial<StageEvent>;
      try {
        msg = JSON.parse(line);
      } catch {
        throw new ApiError("Shelf sent an unreadable reply. Please try again.", 0);
      }
      if (msg.type === "stage") onStage(msg as StageEvent);
      else if (msg.type === "result") return { shop: msg.shop ?? {}, products: msg.products ?? [] };
      else if (msg.type === "error") {
        throw new ApiError(
          typeof msg.error === "string" && msg.error ? msg.error : "Import failed.",
          typeof msg.status === "number" ? msg.status : 500,
        );
      }
    }
    if (done) break;
  }
  throw new ApiError("The import stopped before it finished. Please try again.", 0);
}

const SAMPLE_LIST = `Alder & Pine — small-batch woodwork, Asheville NC
everything carved by hand from local hardwood, finished w/ food-safe oil

cherry wood spoon 24
walnut serving board – 68 (big one, great for cheese)
maple coffee scoop $18
butter knife set of 2 / 30
oak spatula (left-handed ones too!!)`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let keySeq = 0;
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}-${++keySeq}`;

function draftToRow(d: DraftProduct): CatalogRow {
  return {
    title: d.title?.trim() || "Untitled product",
    description: d.description ?? null,
    price: d.price ?? null,
    currency: d.currency || "USD",
    image_url: d.image_url ?? null,
    tags: d.tags ?? [],
    attributes: d.attributes ?? {},
    ai_fields: d.ai_fields ?? [],
    market_low: d.market_low ?? null,
    market_median: d.market_median ?? null,
    market_high: d.market_high ?? null,
    stock: d.stock ?? 10,
    key: newKey(),
  };
}

function productToRow(p: Product, key = p.id): CatalogRow {
  return {
    key,
    id: p.id,
    title: p.title,
    description: p.description,
    price: p.price,
    currency: p.currency,
    image_url: p.image_url,
    tags: p.tags ?? [],
    attributes: p.attributes ?? {},
    ai_fields: p.ai_fields ?? [],
    market_low: p.market_low,
    market_median: p.market_median,
    market_high: p.market_high,
    stock: p.stock,
  };
}

function rowToDraft(r: CatalogRow): DraftProduct {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { key, id, ...draft } = r;
  return draft;
}

function applyEdit(row: CatalogRow, edit: CatalogEdit): CatalogRow {
  const ai_fields = clearAiField(row, edit.field);
  if (edit.field.startsWith("attributes.")) {
    const k = edit.field.slice("attributes.".length);
    const attributes = { ...row.attributes };
    if (edit.value == null || edit.value === "") delete attributes[k];
    else attributes[k] = String(edit.value);
    return { ...row, attributes, ai_fields };
  }
  return { ...row, [edit.field]: edit.value, ai_fields } as CatalogRow;
}

/** PATCH body for a saved product. The server drops edited fields from ai_fields itself. */
function patchBody(next: CatalogRow, edit: CatalogEdit) {
  if (edit.field.startsWith("attributes.")) return { attributes: next.attributes };
  return { [edit.field]: edit.value };
}

const isPriced = (r: CatalogRow) => r.price != null && r.price > 0;

function shopToForm(s: Shop): ShopForm {
  return {
    name: s.name ?? "",
    tagline: s.tagline ?? "",
    about: s.about ?? "",
    location: s.location ?? "",
    paypal_email: s.paypal_email ?? "",
    source_url: s.source_url ?? null,
  };
}

function tryQuery(rows: CatalogRow[]) {
  const r = rows.find((x) => x.title && x.price) ?? rows[0];
  if (!r) return "Find me something handmade from a small independent shop";
  const under = r.price ? ` under ${money(Math.ceil((r.price + 5) / 10) * 10)}` : "";
  return `Find me a ${r.title.toLowerCase()} from a small independent shop${under}`;
}

// ---------- component ----------

export function SellFlow({ resumeShopId }: { resumeShopId: string | null }) {
  const [phase, setPhase] = useState<Phase>(resumeShopId ? "resuming" : "input");
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [prices, setPrices] = useState<{ done: number; total: number } | null>(null);
  const importAbort = useRef<AbortController | null>(null);

  const [form, setForm] = useState<ShopForm>(EMPTY_FORM);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const creating = useRef(new Set<string>());
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const liveRef = useRef<HTMLDivElement | null>(null);
  const live = shop?.status === "published";

  // Resume editing an existing shop (/sell?shop=id), authorized by the stored token or cookie.
  useEffect(() => {
    if (!resumeShopId) return;
    const ctrl = new AbortController();
    api<{ shop: Shop; products: Product[] }>(`/api/shops/${resumeShopId}`, { shopId: resumeShopId, signal: ctrl.signal })
      .then(({ shop, products }) => {
        setShop(shop);
        setForm(shopToForm(shop));
        setRows(products.map((p) => productToRow(p)));
        setPhase("review");
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        setResumeError(
          err instanceof ApiError && (err.status === 401 || err.status === 403)
            ? "This shop can only be edited from the browser that created it."
            : errorMessage(err, "Couldn't open this shop."),
        );
      });
    return () => ctrl.abort();
  }, [resumeShopId]);

  // Elapsed timer while importing.
  useEffect(() => {
    if (phase !== "importing") return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => importAbort.current?.abort(), []);

  // The publish moment: bring the "Live." band into view once it has rendered.
  useEffect(() => {
    if (!justPublished) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    liveRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [justPublished]);

  // ---------- import ----------

  async function runImport(e?: React.FormEvent) {
    e?.preventDefault();
    setImportError(null);
    const body: { url?: string; text?: string } = {};
    if (mode === "url") {
      let u = url.trim();
      if (!u) return setImportError("Paste a link to your shop.");
      if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
      try {
        new URL(u);
      } catch {
        return setImportError("That doesn't look like a web address. Try something like https://yourshop.com.");
      }
      body.url = u;
    } else {
      const t = text.trim();
      if (t.length < 8) return setImportError("Paste your product list. A line per item is plenty.");
      body.text = t;
    }

    const ctrl = new AbortController();
    importAbort.current = ctrl;
    setPrices(null);
    setPhase("importing");
    const driver = createStageDriver(setStageIdx, MIN_STAGE_MS);
    ctrl.signal.addEventListener("abort", () => driver.cancel(), { once: true });
    try {
      const res = await importWithProgress(body, ctrl.signal, (e) => {
        driver.reach(STAGE_INDEX[e.stage]);
        if (e.stage === "prices") setPrices({ done: e.done, total: e.total });
      });
      await driver.done();
      if (ctrl.signal.aborted) {
        setPhase("input");
        return;
      }
      const products = (res.products ?? []).map(draftToRow);
      if (products.length === 0) {
        setPhase("input");
        setImportError(
          mode === "url"
            ? "Shelf couldn't find products on that page. Try your shop's catalog page, or paste a list instead."
            : "Shelf couldn't find products in that text. Put each item on its own line with a price.",
        );
        return;
      }
      setForm({
        name: res.shop?.name?.trim() || "",
        tagline: res.shop?.tagline?.trim() || "",
        about: res.shop?.about?.trim() || "",
        location: res.shop?.location?.trim() || "",
        paypal_email: "",
        source_url: body.url ?? null,
      });
      setRows(products);
      setShop(null);
      setPhase("review");
      window.scrollTo({ top: 0 });
    } catch (err) {
      driver.cancel();
      if ((err as Error)?.name === "AbortError") {
        setPhase("input");
        return;
      }
      setPhase("input");
      setImportError(
        mode === "url"
          ? `${errorMessage(err, "Couldn't read that page.")} You can also paste your product list instead.`
          : errorMessage(err, "Couldn't read that list."),
      );
    } finally {
      importAbort.current = null;
    }
  }

  function cancelImport() {
    importAbort.current?.abort();
  }

  // ---------- catalog edits ----------

  const createRow = useCallback(async (shopId: string, key: string, row: CatalogRow) => {
    if (creating.current.has(key)) return;
    creating.current.add(key);
    setSaving((n) => n + 1);
    setSaveError(null);
    try {
      const { product } = await api<{ product: Product }>(`/api/shops/${shopId}/products`, {
        method: "POST",
        shopId,
        body: rowToDraft(row),
      });
      setRows((rs) => rs.map((r) => (r.key === key ? productToRow(product, key) : r)));
      return product;
    } catch (err) {
      setSaveError(`Couldn't save ${row.title}: ${errorMessage(err)}`);
      throw err;
    } finally {
      creating.current.delete(key);
      setSaving((n) => n - 1);
    }
  }, []);

  const onEdit = useCallback(
    (key: string, edit: CatalogEdit) => {
      const prev = rowsRef.current.find((r) => r.key === key);
      if (!prev) return;
      const next = applyEdit(prev, edit);
      setRows((rs) => rs.map((r) => (r.key === key ? next : r)));
      if (!shop) return; // draft: local state only until publish
      if (!prev.id) {
        // New row in a saved shop: create it once it has a price (live shops reject unpriced products).
        if (isPriced(next)) createRow(shop.id, key, next).catch(() => {}); // error shown via saveError
        return;
      }

      setSaving((n) => n + 1);
      setSaveError(null);
      api<{ product: Product }>(`/api/shops/${shop.id}/products/${prev.id}`, {
        method: "PATCH",
        shopId: shop.id,
        body: patchBody(next, edit),
      })
        .then(({ product }) => setRows((rs) => rs.map((r) => (r.key === key ? productToRow(product, key) : r))))
        .catch((err) => {
          setRows((rs) => rs.map((r) => (r.key === key ? prev : r)));
          setSaveError(`Couldn't save ${prev.title}: ${errorMessage(err)}`);
        })
        .finally(() => setSaving((n) => n - 1));
    },
    [shop, createRow],
  );

  const onRemove = useCallback(
    (key: string) => {
      const row = rowsRef.current.find((r) => r.key === key);
      if (!row) return;
      if (shop && row.id && !window.confirm(`Remove “${row.title}” from your shop?`)) return;
      const before = rowsRef.current;
      setRows((rs) => rs.filter((r) => r.key !== key));
      if (!shop || !row.id) return;
      setSaving((n) => n + 1);
      api(`/api/shops/${shop.id}/products/${row.id}`, { method: "DELETE", shopId: shop.id })
        .catch((err) => {
          setRows(before);
          setSaveError(`Couldn't remove ${row.title}: ${errorMessage(err)}`);
        })
        .finally(() => setSaving((n) => n - 1));
    },
    [shop],
  );

  function addProduct() {
    const blank: DraftProduct = {
      title: "New product",
      description: null,
      price: null,
      currency: "USD",
      image_url: null,
      tags: [],
      attributes: {},
      ai_fields: [],
      market_low: null,
      market_median: null,
      market_high: null,
      stock: 10,
    };
    // Always starts local; in a saved shop it is created as soon as it has a price.
    setRows((rs) => [...rs, draftToRow(blank)]);
  }

  // ---------- shop fields ----------

  function setField<K extends keyof ShopForm>(k: K, v: ShopForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /** Saved shops persist field edits on blur. */
  async function commitField(k: Exclude<keyof ShopForm, "source_url">) {
    if (!shop) return;
    const value = form[k].trim();
    if ((shop[k] ?? "") === value) return;
    if (k === "name" && !value) return setField("name", shop.name);
    if (k === "paypal_email" && value && !EMAIL_RE.test(value)) return;
    setSaving((n) => n + 1);
    setSaveError(null);
    try {
      const res = await api<{ shop: Shop }>(`/api/shops/${shop.id}`, {
        method: "PATCH",
        shopId: shop.id,
        body: { [k]: value || null },
      });
      setShop(res.shop);
    } catch (err) {
      setSaveError(`Couldn't save ${k === "paypal_email" ? "PayPal email" : k}: ${errorMessage(err)}`);
    } finally {
      setSaving((n) => n - 1);
    }
  }

  // ---------- publish ----------

  const issues = useMemo(() => {
    const out: string[] = [];
    if (!form.name.trim()) out.push("Add your shop name.");
    if (!EMAIL_RE.test(form.paypal_email.trim())) out.push("Add the PayPal email where you want to be paid.");
    if (rows.length === 0) out.push("Add at least one product.");
    const unpriced = rows.filter((r) => r.price == null || r.price <= 0).length;
    if (unpriced) out.push(`${unpriced} ${unpriced === 1 ? "product needs" : "products need"} a price.`);
    return out;
  }, [form.name, form.paypal_email, rows]);

  async function publish() {
    if (issues.length) {
      setShowIssues(true);
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      let current = shop;
      const shopFields = {
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        about: form.about.trim() || null,
        location: form.location.trim() || null,
        paypal_email: form.paypal_email.trim(),
      };
      if (!current) {
        const created = await api<{ shop: Shop; products: Product[]; token: string }>("/api/shops", {
          method: "POST",
          body: { shop: { ...shopFields, source_url: form.source_url }, products: rows.map(rowToDraft) },
        });
        saveToken(created.shop.id, created.token);
        current = created.shop;
        setShop(created.shop);
        setRows(created.products.map((p) => productToRow(p)));
        window.history.replaceState(null, "", `/sell?shop=${created.shop.id}`);
      } else {
        const { shop: updated } = await api<{ shop: Shop }>(`/api/shops/${current.id}`, {
          method: "PATCH",
          shopId: current.id,
          body: shopFields,
        });
        current = updated;
        const sid = current.id;
        for (const r of rowsRef.current.filter((x) => !x.id)) await createRow(sid, r.key, r);
      }
      const { shop: published } = await api<{ shop: Shop }>(`/api/shops/${current.id}/publish`, {
        method: "POST",
        shopId: current.id,
      });
      setShop(published);
      setJustPublished(true);
      setShowIssues(false);
    } catch (err) {
      setPublishError(errorMessage(err, "Publishing failed. Try again."));
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (!shop) return;
    if (!window.confirm(`Take ${shop.name} off Shelf? Assistants will stop finding it until you publish again.`)) return;
    setPublishError(null);
    try {
      const { shop: s } = await api<{ shop: Shop }>(`/api/shops/${shop.id}/publish`, { method: "DELETE", shopId: shop.id });
      setShop(s);
      setJustPublished(false);
    } catch (err) {
      setPublishError(errorMessage(err, "Couldn't unpublish."));
    }
  }

  // ---------- render ----------

  const step = phase === "review" ? (live ? 3 : 2) : 1;
  const unsaved = shop ? rows.filter((r) => !r.id).length : 0;
  const aiCount = rows.reduce((n, r) => n + (r.ai_fields?.length ?? 0), 0);
  const marketCount = rows.filter((r) => r.market_median != null).length;

  return (
    <div className="pb-24">
      <Steps step={step} />

      {phase === "resuming" && (
        <section className="wrap py-16">
          {resumeError ? (
            <div className="max-w-[60ch]">
              <h1 className="display text-[44px]">Can&rsquo;t open this shop here</h1>
              <p className="mt-4 text-ink/80" role="alert">
                {resumeError}
              </p>
              <Link href="/sell" className="btn mt-8" onClick={() => setPhase("input")}>
                Start a new shop
              </Link>
            </div>
          ) : (
            <p className="text-muted">Opening your shop…</p>
          )}
        </section>
      )}

      {phase === "input" && (
        <section className="wrap grid gap-12 py-12 sm:py-16 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h1 className="display text-[52px] sm:text-[72px]">Bring your shop.</h1>
            <p className="mt-6 max-w-[46ch] text-[17px] leading-[1.6] text-ink/80">
              Paste a link to your shop or a list of what you sell. Shelf&rsquo;s AI writes the details assistants need,
              and Channel3 checks what similar pieces sell for. Nothing goes live until you publish.
            </p>
          </div>

          <form className="lg:col-span-7 lg:pt-3" onSubmit={runImport} noValidate>
            <div role="tablist" aria-label="Import from" className="flex gap-7 border-b border-line">
              {(
                [
                  ["url", "Shop link"],
                  ["text", "Paste a list"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setImportError(null);
                  }}
                  className={`-mb-px border-b pb-3 text-[15px] transition-colors ${
                    mode === m ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="pt-8">
              {mode === "url" ? (
                <>
                  <label htmlFor="shop-url" className="label">
                    Your shop&rsquo;s web address
                  </label>
                  <input
                    id="shop-url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    placeholder="https://yourshop.com"
                    className="field mono text-[15px]"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-invalid={!!importError}
                    autoFocus
                  />
                  <p className="mt-3 text-[13px] text-muted">
                    Your own site, a Shopify or Squarespace store, or a single catalog page.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="shop-text" className="label">
                      What you sell, however it&rsquo;s written
                    </label>
                    <button type="button" className="link text-[12px] text-muted" onClick={() => setText(SAMPLE_LIST)}>
                      Use a sample list
                    </button>
                  </div>
                  <textarea
                    id="shop-text"
                    rows={9}
                    placeholder={"speckled mug 28\nblue celadon cup $34, holds about 8oz\noatmeal bowl — dm for price"}
                    className="field mono text-[14px] leading-[1.6]"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-invalid={!!importError}
                    autoFocus
                  />
                  <p className="mt-3 text-[13px] text-muted">An Instagram caption, a price list, notes from your market stall.</p>
                </>
              )}

              {importError && (
                <p role="alert" className="mt-5 text-[14px] text-accent">
                  {importError}
                </p>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-6">
                <button type="submit" className="btn">
                  Read my shop
                </button>
                <span className="text-[13px] text-muted">Takes about half a minute.</span>
              </div>
            </div>
          </form>
        </section>
      )}

      {phase === "importing" && (
        <section className="wrap py-12 sm:py-16" aria-live="polite">
          <div className="max-w-[720px]">
            <h1 className="display text-[44px] leading-[1.05] sm:text-[60px]">
              Reading {mode === "url" && url ? hostOf(/^https?:\/\//i.test(url) ? url : `https://${url}`) : "your list"}
            </h1>
            <div className="progress mt-10" role="progressbar" aria-label="Importing" />
            <ol className="mt-2">
              {STAGES.map((label, i) => {
                const active = i === stageIdx;
                const past = i < stageIdx;
                return (
                  <li
                    key={label}
                    className={`flex items-baseline justify-between gap-4 border-b border-line py-4 text-[16px] transition-colors ${
                      active ? "text-ink" : past ? "text-ink/70" : "text-muted/60"
                    }`}
                  >
                    <span>
                      {label}
                      {active ? "…" : ""}
                    </span>
                    {active && (
                      <span className="mono text-[12px] text-accent">
                        {i === STAGE_INDEX.prices && prices && prices.total > 0
                          ? `${Math.min(prices.done, prices.total)} of ${prices.total}`
                          : "now"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex items-center justify-between text-[13px] text-muted">
              <span>Usually 15–40 seconds.</span>
              <span className="mono tabular-nums">{Math.floor(elapsed)}s</span>
            </div>
            <button type="button" className="link mt-10 text-[14px] text-muted" onClick={cancelImport}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {phase === "review" && (
        <section className="wrap-wide">
          {live && shop && (
            <div ref={liveRef} className="scroll-mt-6 border-b border-line pb-12 pt-10 sm:pt-14">
              <div className={justPublished ? "rise" : undefined}>
                <p className="flex items-center gap-2 text-[13px] font-medium text-ok">
                  <span className="dot dot-live" aria-hidden />
                  Live on Shelf
                </p>
                <h1 className="display mt-4 text-[64px] sm:text-[104px]">Live.</h1>
                <div className={`mt-2 h-px w-full max-w-[560px] bg-accent ${justPublished ? "draw" : ""}`} aria-hidden />
                <p className="mt-6 max-w-[56ch] text-[19px] leading-[1.5]">
                  Any assistant connected to Shelf can find and buy from {shop.name} now.
                </p>
              </div>
              <div className={`mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 ${justPublished ? "rise rise-2" : ""}`}>
                <Link href={`/dash/${shop.id}`} className="btn">
                  Open dashboard
                </Link>
                <Link href={`/s/${shop.slug}`} className="link text-[15px]">
                  View public page
                </Link>
                <button type="button" className="link text-[14px] text-muted" onClick={unpublish}>
                  Unpublish
                </button>
              </div>
              <div className={`mt-10 max-w-[720px] ${justPublished ? "rise rise-3" : ""}`}>
                <p className="label">Try it in Claude</p>
                <div className="flex items-stretch border border-line bg-surface">
                  <p className="min-w-0 flex-1 px-4 py-3 text-[15px]">&ldquo;{tryQuery(rows)}&rdquo;</p>
                  <CopyButton value={tryQuery(rows)} className="link border-l border-line px-4 text-[13px] no-underline" />
                </div>
                <p className="mt-2 text-[13px] text-muted">
                  Shelf not in Claude yet?{" "}
                  <Link href="/#connect" className="link text-muted">
                    Connect it
                  </Link>{" "}
                  in under a minute.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-8 pt-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-4">
              <p className="eyebrow">{live ? "Your catalog" : "Review"}</p>
              <h2 className="display mt-3 text-[40px] leading-[1.05] sm:text-[52px]">{form.name.trim() || "Your shop"}</h2>
              <p className="mt-4 max-w-[40ch] text-[15px] text-ink/75">
                {rows.length} {rows.length === 1 ? "product" : "products"}.{" "}
                {aiCount > 0 && (
                  <>
                    Shelf&rsquo;s AI wrote {aiCount} {aiCount === 1 ? "detail" : "details"}.{" "}
                  </>
                )}
                {marketCount > 0 && (
                  <>
                    Channel3 found market prices for {marketCount} of {rows.length}.
                  </>
                )}
              </p>
              {form.source_url && (
                <p className="mono mt-3 truncate text-[12px] text-muted" title={form.source_url}>
                  from {hostOf(form.source_url)}
                </p>
              )}
            </div>

            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:col-span-8">
              <Field label="Shop name" htmlFor="f-name">
                <input
                  id="f-name"
                  className="field"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  onBlur={() => commitField("name")}
                  aria-invalid={showIssues && !form.name.trim()}
                />
              </Field>
              <Field label="Location" htmlFor="f-location">
                <input
                  id="f-location"
                  className="field"
                  placeholder="City, State"
                  value={form.location}
                  onChange={(e) => setField("location", e.target.value)}
                  onBlur={() => commitField("location")}
                />
              </Field>
              <Field label="One line about your shop" htmlFor="f-tagline" wide>
                <input
                  id="f-tagline"
                  className="field"
                  value={form.tagline}
                  onChange={(e) => setField("tagline", e.target.value)}
                  onBlur={() => commitField("tagline")}
                />
              </Field>
              <Field label="About" htmlFor="f-about" wide>
                <textarea
                  id="f-about"
                  rows={3}
                  className="field"
                  value={form.about}
                  onChange={(e) => setField("about", e.target.value)}
                  onBlur={() => commitField("about")}
                />
              </Field>
              <Field
                label="PayPal email for payouts"
                htmlFor="f-paypal"
                wide
                hint="Buyers pay this PayPal account directly. Shelf never holds your money."
              >
                <input
                  id="f-paypal"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  spellCheck={false}
                  placeholder="you@yourshop.com"
                  className="field mono text-[15px]"
                  value={form.paypal_email}
                  onChange={(e) => setField("paypal_email", e.target.value)}
                  onBlur={() => commitField("paypal_email")}
                  aria-invalid={
                    (showIssues || form.paypal_email.length > 3) && !EMAIL_RE.test(form.paypal_email.trim())
                  }
                />
              </Field>
            </div>
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink/75">
              <span className="inline-flex items-center gap-1.5 bg-ai px-2 py-0.5 text-ai-ink">
                <span className="mono text-[10px] font-semibold tracking-[0.06em]">AI</span>
                <span>filled by Shelf</span>
              </span>
              <span>Click any cell to edit. Your edits replace the highlight.</span>
            </p>
            <p className="mono text-[12px] text-muted" aria-live="polite">
              {!shop
                ? "Draft. Publishing saves it."
                : saving > 0
                  ? "Saving…"
                  : unsaved > 0
                    ? `${unsaved} new ${unsaved === 1 ? "product saves" : "products save"} once priced`
                    : "All changes saved"}
            </p>
          </div>

          <div className="mt-4">
            <CatalogGrid rows={rows} onEdit={onEdit} onRemove={onRemove} />
          </div>

          {saveError && (
            <p role="alert" className="mt-3 text-[14px] text-accent">
              {saveError}
            </p>
          )}

          <div className="mt-4">
            <button type="button" className="link text-[14px]" onClick={addProduct}>
              Add a product
            </button>
          </div>

          {!live && (
            <div className="mt-12 grid gap-6 border-t border-ink pt-8 lg:grid-cols-12 lg:items-start">
              <div className="lg:col-span-8">
                {issues.length > 0 && (showIssues || publishError) ? (
                  <ul className="space-y-1 text-[15px] text-warn" role="alert">
                    {issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : issues.length > 0 ? (
                  <p className="text-[15px] text-ink/80">
                    Before you publish: {issues.map((i) => i.replace(/\.$/, "").replace(/^\w/, (c) => c.toLowerCase())).join("; ")}.
                  </p>
                ) : (
                  <p className="text-[15px] text-ink/80">
                    Publishing makes {rows.length} {rows.length === 1 ? "product" : "products"} searchable and buyable in
                    every assistant connected to Shelf. You can keep editing afterwards.
                  </p>
                )}
                {publishError && (
                  <p role="alert" className="mt-3 text-[14px] text-accent">
                    {publishError}
                  </p>
                )}
              </div>
              <div className="lg:col-span-4 lg:text-right">
                <button
                  type="button"
                  className="btn h-12 w-full px-8 text-[15px] sm:w-auto"
                  onClick={publish}
                  disabled={publishing}
                  aria-disabled={issues.length > 0 || publishing}
                >
                  {publishing ? "Publishing…" : "Publish to Shelf"}
                </button>
              </div>
            </div>
          )}

          {live && publishError && (
            <p role="alert" className="mt-6 text-[14px] text-accent">
              {publishError}
            </p>
          )}

          {!shop && (
            <div className="mt-10">
              <button
                type="button"
                className="link text-[13px] text-muted"
                onClick={() => {
                  if (window.confirm("Discard this draft and start over?")) {
                    setRows([]);
                    setForm(EMPTY_FORM);
                    setPhase("input");
                  }
                }}
              >
                Start over
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && <p className="mt-2 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Import", "Review", "Publish"];
  return (
    <div className="border-b border-line">
      <ol className="wrap-wide flex h-12 items-center gap-6 text-[13px] sm:gap-10" aria-label="Progress">
        {items.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex h-full items-center gap-2 border-b ${
                state === "current" ? "border-accent text-ink" : "border-transparent"
              } ${state === "todo" ? "text-muted" : "text-ink"}`}
            >
              <span className="mono text-[12px] text-muted">{n}</span>
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
