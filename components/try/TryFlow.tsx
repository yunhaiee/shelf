"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftProduct, Product, Shop } from "@/lib/types";
import { ApiError, errorMessage, saveToken } from "@/components/api";
import { CopyButton } from "@/components/CopyButton";
import { CatalogGrid, type CatalogRow } from "@/components/grid/CatalogGrid";
import { OrdersGrid, type OrderRow } from "@/components/grid/OrdersGrid";

// ---------- types ----------

type ImportedShop = { name?: string | null; tagline?: string | null; about?: string | null; location?: string | null };
type ImportResult = { shop: ImportedShop; products: DraftProduct[] };
type StageEvent = { stage: "read" } | { stage: "write" } | { stage: "prices"; done: number; total: number };
type ToolCall = { name: string; input: string; result: string; is_error: boolean };
type ChatMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; history: string; tools: ToolCall[]; approveUrl: string | null };
type Status = { shop: Shop | null; orders: OrderRow[]; products?: Product[] };

const PROMPT =
  "Use Shelf. My sister Jiwoo's birthday is Saturday and she just got into pour-over coffee. Something handmade from a small studio, a mug or a dripper, under $40, that I can buy right here?";
const FOLLOW_UP = "Did it go through?";
const SESSION_KEY = "shelf_try_session";
const STAGE_LABEL = ["Reading the caption", "Writing agent-ready details", "Checking market prices with Channel3"];

// ---------- helpers ----------

function newSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Very old browsers: RFC 4122 v4 from Math.random (fine for a demo key).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This tab's session id from sessionStorage (survives a reload), else a new one. Never put in the URL: the id is
 * the session's only key, so a copied /try link must not share it.
 */
function resolveSession(): string {
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    id = null;
  }
  if (!id || !UUID_RE.test(id)) id = newSessionId();
  id = id.toLowerCase();
  try {
    window.sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage blocked: the session lasts until reload */
  }
  // Older links carried ?s=<id>; drop it so nobody re-shares it.
  const url = new URL(window.location.href);
  if (url.searchParams.has("s")) {
    url.searchParams.delete("s");
    window.history.replaceState(null, "", url.toString());
  }
  return id;
}

function stopwatch(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let keySeq = 0;
function toRow(d: DraftProduct | Product): CatalogRow {
  return {
    key: "id" in d ? d.id : `d${++keySeq}`,
    title: d.title,
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
  };
}

function toDraft(r: CatalogRow): DraftProduct {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { key, id, ...draft } = r;
  return draft;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach Shelf. Check your connection and try again.", 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const msg = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof msg === "string" && msg ? msg : `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

/** POST /api/try/import with NDJSON progress. */
async function importWithProgress(text: string, onStage: (e: StageEvent) => void): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch("/api/try/import", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach Shelf. Check your connection and try again.", 0);
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* empty */
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
      const msg = JSON.parse(line) as { type?: string; error?: unknown; status?: unknown } & Partial<ImportResult> &
        Partial<StageEvent>;
      if (msg.type === "stage") onStage(msg as StageEvent);
      else if (msg.type === "result") return { shop: msg.shop ?? {}, products: msg.products ?? [] };
      else if (msg.type === "error") {
        throw new ApiError(typeof msg.error === "string" ? msg.error : "Import failed.", Number(msg.status) || 500);
      }
    }
    if (done) break;
  }
  throw new ApiError("The import stopped before it finished. Please try again.", 0);
}

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Plain text with bare URLs turned into links. */
function Linked({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="link break-all">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Step({ n, label, title, children, id }: { n: string; label: string; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="border-t border-line py-12 sm:py-16">
      <div className="wrap">
        <p className="eyebrow">
          <span className="mono text-accent">{n}</span>
          <span className="mx-2 text-line">/</span>
          {label}
        </p>
        <h2 className="display mt-3 max-w-[22ch] text-[34px] leading-[1.05] sm:text-[48px]">{title}</h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

// ---------- component ----------

export function TryFlow({
  initialText,
  sampleAvailable,
  buyer,
  mcpUrl,
}: {
  initialText: string;
  sampleAvailable: boolean;
  buyer: { email: string; password: string };
  mcpUrl: string;
}) {
  const [session, setSession] = useState<string | null>(null);

  // 01 seller
  const [text, setText] = useState(initialText);
  const [phase, setPhase] = useState<"input" | "importing" | "review" | "publishing" | "live">("input");
  const [stage, setStage] = useState<{ i: number; done?: number; total?: number }>({ i: 0 });
  const [draftShop, setDraftShop] = useState<ImportedShop | null>(null);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [sellerError, setSellerError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 02 shopper
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState(PROMPT);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // 04 dashboard
  const [status, setStatus] = useState<Status>({ shop: null, orders: [] });
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const prevOrders = useRef<Map<string, string>>(new Map());

  const shop = status.shop;
  const approveUrl = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i];
      if (m.role === "assistant" && m.approveUrl) return m.approveUrl;
    }
    return null;
  }, [chat]);
  const hasOrders = status.orders.length > 0;

  const applyStatus = useCallback((s: Status) => {
    const changed: string[] = [];
    for (const o of s.orders) {
      const before = prevOrders.current.get(o.id);
      if (before !== undefined && before !== o.status) changed.push(o.id);
      if (before === undefined && prevOrders.current.size > 0) changed.push(o.id);
    }
    prevOrders.current = new Map(s.orders.map((o) => [o.id, o.status]));
    setStatus((prev) => ({ ...s, products: s.products ?? prev.products }));
    if (changed.length) setFlashIds(changed);
  }, []);

  // Session + restore after a reload.
  useEffect(() => {
    const id = resolveSession();
    setSession(id);
    fetch(`/api/try/status?session=${id}&full=1`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then((s) => {
        if (!s?.shop) return;
        prevOrders.current = new Map(s.orders.map((o) => [o.id, o.status]));
        setStatus(s);
        if (s.products?.length) setRows(s.products.map(toRow));
        setDraftShop({ name: s.shop.name, location: s.shop.location });
        setPhase("live");
      })
      .catch(() => {});
  }, []);

  // Stopwatch + "Claude is working" timer.
  const ticking = (startedAt != null && stoppedAt == null) || sending;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [ticking]);

  // Poll the demo shop's orders: every 2s once a checkout exists, else slowly.
  useEffect(() => {
    if (!session || !shop) return;
    let stop = false;
    const fast = !!approveUrl || hasOrders;
    const tick = async () => {
      try {
        const r = await fetch(`/api/try/status?session=${session}`, { cache: "no-store" });
        if (r.ok && !stop) applyStatus((await r.json()) as Status);
      } catch {
        /* next tick */
      }
    };
    const t = setInterval(tick, fast ? 2000 : 8000);
    if (fast) void tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [session, shop, approveUrl, hasOrders, applyStatus]);

  const startClock = () => setStartedAt((s) => s ?? Date.now());

  async function runImport() {
    if (!text.trim()) return setSellerError("Paste a product list first.");
    setSellerError(null);
    startClock();
    setStoppedAt(null);
    setPhase("importing");
    setStage({ i: 0 });
    try {
      const result = await importWithProgress(text, (e) =>
        setStage(e.stage === "read" ? { i: 0 } : e.stage === "write" ? { i: 1 } : { i: 2, done: e.done, total: e.total }),
      );
      setDraftShop(result.shop);
      setRows(result.products.map(toRow));
      setPhase("review");
    } catch (err) {
      setSellerError(errorMessage(err, "Import failed. Try again."));
      setPhase("input");
    }
  }

  async function useSample() {
    setSellerError(null);
    startClock();
    setStoppedAt(null);
    setPhase("importing");
    setStage({ i: 0 });
    try {
      const result = await postJson<ImportResult>("/api/try/import", { sample: true });
      setDraftShop(result.shop);
      setRows(result.products.map(toRow));
      setPhase("review");
    } catch (err) {
      setSellerError(errorMessage(err));
      setPhase("input");
    }
  }

  async function publish() {
    if (!session || !draftShop) return;
    setSellerError(null);
    setPhase("publishing");
    try {
      const res = await postJson<{ shop: Shop; products: Product[]; token: string }>("/api/try/publish", {
        session,
        shop: {
          name: draftShop.name?.trim() || "Hanul Clay",
          tagline: draftShop.tagline ?? null,
          about: draftShop.about ?? null,
          location: draftShop.location ?? null,
        },
        products: rows.map(toDraft),
      });
      saveToken(res.shop.id, res.token);
      setStoppedAt(Date.now());
      setRows(res.products.map(toRow));
      prevOrders.current = new Map();
      setStatus({ shop: res.shop, orders: [], products: res.products });
      setPhase("live");
    } catch (err) {
      setSellerError(errorMessage(err, "Publishing failed. Try again."));
      setPhase("review");
    }
  }

  async function send(content: string) {
    const msg = content.trim();
    if (!session || !msg || sending) return;
    const next: ChatMsg[] = [...chat, { role: "user", content: msg }];
    setChat(next);
    setInput("");
    setChatError(null);
    setSending(true);
    setSentAt(Date.now());
    // Only text goes back each turn; assistant turns carry compact tool notes (ids) so follow-ups work.
    let turns = next.map((m) => ({ role: m.role, content: m.role === "assistant" ? m.history : m.content })).slice(-19);
    while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
    try {
      const res = await postJson<{ reply: string; history: string; tools: ToolCall[]; approveUrl: string | null }>(
        "/api/try/chat",
        { session, messages: turns },
      );
      setChat((c) => [
        ...c,
        { role: "assistant", content: res.reply, history: res.history, tools: res.tools ?? [], approveUrl: res.approveUrl },
      ]);
    } catch (err) {
      setChatError(errorMessage(err, "Claude couldn't answer. Try again."));
      setChat(chat); // drop the unanswered turn so the history stays valid
      setInput(msg);
    } finally {
      setSending(false);
    }
  }

  function newChat() {
    setChat([]);
    setChatError(null);
    setInput(PROMPT);
  }

  const elapsed = startedAt != null ? (stoppedAt ?? now) - startedAt : 0;
  const shopName = draftShop?.name?.trim() || shop?.name || "Mina's shop";

  return (
    <div className="pb-8">
      {/* intro */}
      <section className="wrap py-12 sm:py-16">
        <p className="eyebrow">Judge demo · one page</p>
        <h1 className="display mt-4 text-[48px] sm:text-[80px]">Try Shelf end to end.</h1>
        <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.6] text-ink/80">
          Be the seller, then the shopper. A small studio goes live from an Instagram caption, Claude finds her over MCP,
          and you pay her with PayPal Sandbox. Everything here is live: Claude, Channel3, PayPal. About three minutes.
        </p>
        <p className="mt-4 text-[13px] text-muted">
          Your copy of the shop is private to this tab. Mina and Hanul Clay are fictional. No real money moves.
        </p>
      </section>

      {/* 01 seller */}
      <Step n="01" label="Seller" title="Mina’s whole store is this Instagram caption.">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="try-caption" className="label">
                @hanulclay · Instagram
              </label>
              <span className="mono text-[12px] text-muted" aria-live="polite">
                Mina&rsquo;s setup · real time <span className="tabular-nums text-ink">{stopwatch(elapsed)}</span>
              </span>
            </div>
            <textarea
              id="try-caption"
              className="field mono text-[13px] leading-[1.6]"
              rows={14}
              maxLength={5000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={startClock}
              disabled={phase === "importing" || phase === "publishing"}
            />
            {phase === "input" && (
              <div className="mt-6 flex flex-wrap items-center gap-6">
                <button type="button" className="btn" onClick={runImport} disabled={!session}>
                  Import
                </button>
                {sampleAvailable && (
                  <button type="button" className="link text-[14px] text-muted" onClick={useSample} disabled={!session}>
                    Skip: use a ready-made copy
                  </button>
                )}
                <span className="text-[13px] text-muted">Claude reads it, Channel3 checks prices. About 30 seconds.</span>
              </div>
            )}
            {sellerError && (
              <p role="alert" className="mt-4 text-[14px] text-accent">
                {sellerError}
              </p>
            )}
          </div>

          <div className="lg:col-span-5" aria-live="polite">
            {phase === "importing" && (
              <>
                <div className="progress" role="progressbar" aria-label="Importing" />
                <ol className="mt-2">
                  {STAGE_LABEL.map((label, i) => (
                    <li
                      key={label}
                      className={`flex items-baseline justify-between gap-4 border-b border-line py-3 text-[15px] ${
                        i <= stage.i ? "text-ink" : "text-muted/60"
                      }`}
                    >
                      <span>
                        {label}
                        {i === stage.i ? "…" : ""}
                      </span>
                      {i === 2 && stage.i === 2 && stage.total ? (
                        <span className="mono text-[12px] text-accent">
                          {stage.done}/{stage.total}
                        </span>
                      ) : i < stage.i ? (
                        <span className="mono text-[12px] text-muted">done</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {(phase === "review" || phase === "publishing") && (
              <div>
                <p className="eyebrow">Draft</p>
                <p className="display mt-2 text-[36px]">{shopName}</p>
                <p className="mt-3 max-w-[40ch] text-[15px] text-ink/75">
                  {rows.length} products. Highlighted cells were written by Claude; the market range comes from Channel3.
                  Payouts go to the demo seller&rsquo;s PayPal Sandbox account.
                </p>
                <button type="button" className="btn mt-6" onClick={publish} disabled={phase === "publishing" || !rows.length}>
                  {phase === "publishing" ? "Publishing…" : "Publish to Shelf"}
                </button>
              </div>
            )}
            {phase === "live" && shop && (
              <div className="rise">
                <p className="flex items-center gap-2 text-[13px] font-medium text-ok">
                  <span className="dot dot-live" aria-hidden />
                  {shop.name} is on Shelf
                </p>
                <p className="display mt-3 text-[72px] sm:text-[96px]">Live.</p>
                <div className="draw mt-1 h-px w-full max-w-[360px] bg-accent" aria-hidden />
                {startedAt != null && (
                  <p className="mono mt-4 text-[13px] text-muted">
                    {stopwatch(elapsed)} from paste to live
                  </p>
                )}
                <p className="mt-4 max-w-[40ch] text-[15px] text-ink/80">
                  Any assistant connected to Shelf can now find and buy from {shop.name}. Ask Claude again below.
                </p>
                <p className="mt-4 text-[14px]">
                  <a href={`/s/${shop.slug}`} target="_blank" rel="noreferrer" className="link">
                    Her agent-ready shop page
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>

        {rows.length > 0 && phase !== "importing" && (
          <div className="mt-10">
            <CatalogGrid rows={rows} onEdit={() => {}} readOnly />
          </div>
        )}
      </Step>

      {/* 02 shopper */}
      <Step n="02" label="Shopper" title="Ask Claude. It’s connected to Shelf over MCP.">
        <p className="max-w-[60ch] text-[15px] text-ink/80">
          {shop
            ? "Mina is live. Ask in a new chat and see her mug come up, buyable right here."
            : "Ask now to see the before: Claude can only offer link-outs for mugs. Then publish in step 01 and ask again in a new chat."}
        </p>

        <div className="mt-8 max-w-[820px]">
          {chat.length > 0 && (
            <ol className="border-t border-line">
              {chat.map((m, i) => (
                <li key={i} className="border-b border-line py-5">
                  <p className="eyebrow">{m.role === "user" ? "You" : "Claude"}</p>
                  <div className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.6]">
                    <Linked text={m.content} />
                  </div>
                  {m.role === "assistant" && m.tools.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {m.tools.map((t, j) => (
                        <li key={j} className={`mono text-[12px] leading-[1.5] ${t.is_error ? "text-accent" : "text-muted"}`}>
                          <span className="text-ai-ink">{t.name}</span>
                          {t.input ? <span>({t.input})</span> : null} → {t.result}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.role === "assistant" && m.approveUrl && (
                    <a href={m.approveUrl} target="_blank" rel="noreferrer" className="btn mt-5">
                      Approve on PayPal (sandbox) →
                    </a>
                  )}
                </li>
              ))}
            </ol>
          )}

          {sending && (
            <p className="mono border-b border-line py-5 text-[13px] text-muted" aria-live="polite">
              Claude is working, calling Shelf tools… {sentAt ? stopwatch(now - sentAt) : ""}
            </p>
          )}

          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="try-input" className="label">
              Message Claude
            </label>
            <textarea
              id="try-input"
              className="field text-[15px]"
              rows={3}
              maxLength={4000}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              disabled={sending}
            />
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <button type="submit" className="btn" disabled={sending || !input.trim() || !session}>
                Send
              </button>
              {chat.length > 0 && (
                <button type="button" className="link text-[14px] text-muted" onClick={newChat} disabled={sending}>
                  New chat
                </button>
              )}
              {chat.length > 0 && !sending && (
                <button type="button" className="link text-[14px] text-muted" onClick={() => setInput(PROMPT)}>
                  Use the gift prompt
                </button>
              )}
            </div>
            {chatError && (
              <p role="alert" className="mt-4 text-[14px] text-accent">
                {chatError}
              </p>
            )}
          </form>
        </div>
      </Step>

      {/* 03 approve */}
      <Step n="03" label="Approve" title="Pay with the sandbox buyer.">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <p className="max-w-[48ch] text-[15px] text-ink/80">
              When Claude returns a PayPal link, open it and log in with this buyer. The money goes straight to Mina&rsquo;s
              own PayPal account.
            </p>
            {buyer.email ? (
              <dl className="mt-6 border-b border-line">
                <div className="flex items-baseline justify-between gap-4 border-t border-line py-3">
                  <dt className="eyebrow">Email</dt>
                  <dd className="flex items-baseline gap-4">
                    <span className="mono break-all text-[13px]">{buyer.email}</span>
                    <CopyButton value={buyer.email} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-line py-3">
                  <dt className="eyebrow">Password</dt>
                  <dd className="flex items-baseline gap-4">
                    <span className="mono break-all text-[13px]">{buyer.password}</span>
                    <CopyButton value={buyer.password} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-6 text-[14px] text-muted">The sandbox buyer isn&rsquo;t configured on this deployment.</p>
            )}
            <p className="mt-3 text-[12px] text-muted">PayPal Sandbox test buyer — not a real account.</p>
          </div>
          <div className="lg:col-span-6">
            {approveUrl ? (
              <a href={approveUrl} target="_blank" rel="noreferrer" className="btn">
                Approve on PayPal (sandbox) →
              </a>
            ) : (
              <p className="text-[14px] text-muted">The PayPal link appears here once Claude starts a checkout.</p>
            )}
            <p className="mt-6 text-[15px]">
              Then come back and ask:{" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setInput(FOLLOW_UP);
                  document.getElementById("try-input")?.focus();
                }}
              >
                &ldquo;{FOLLOW_UP}&rdquo;
              </button>
            </p>
          </div>
        </div>
      </Step>

      {/* 04 seller dashboard */}
      <Step n="04" label="Seller dashboard" title="Mina sees the order land.">
        {shop ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <p className="text-[15px] text-ink/80">
                Orders for {shop.name}, with the assistant that sold it and what the shopper asked.
              </p>
              <Link href={`/dash/${shop.id}`} target="_blank" className="link text-[14px]">
                Open Mina&rsquo;s full dashboard
              </Link>
            </div>
            <div className="mt-6">
              <OrdersGrid rows={status.orders} flashIds={flashIds} />
            </div>
          </>
        ) : (
          <p className="text-[15px] text-muted">Publish the shop in step 01 to see her orders here.</p>
        )}
      </Step>

      {/* own Claude */}
      <section className="border-t border-line py-12">
        <div className="wrap max-w-[820px]">
          <p className="eyebrow">Prefer your own Claude?</p>
          <p className="mt-3 text-[15px]">Add a custom connector in Claude: Settings → Connectors → Add custom connector.</p>
          <div className="mt-4 flex items-stretch border border-line bg-surface">
            <p className="mono min-w-0 flex-1 truncate px-4 py-3 text-[13px]">{mcpUrl}</p>
            <CopyButton value={mcpUrl} className="link border-l border-line px-4 text-[13px] no-underline" />
          </div>
          <p className="mt-3 text-[13px] text-muted">
            Then start your message with &ldquo;Use Shelf to …&rdquo;. Your own Claude sees the real network, not this
            tab&rsquo;s private copy.
          </p>
        </div>
      </section>
    </div>
  );
}
