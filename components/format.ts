// Formatting shared by server and client components (no server imports).

const moneyFmt = new Map<string, Intl.NumberFormat>();

export function money(n: number | null | undefined, currency = "USD", opts: { cents?: boolean } = {}) {
  if (n == null || Number.isNaN(n)) return "";
  const cents = opts.cents ?? !Number.isInteger(n);
  const key = `${currency}:${cents}`;
  let f = moneyFmt.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    }
    moneyFmt.set(key, f);
  }
  return f.format(n);
}

/** "$12–$28" or null when Channel3 had no comparable items. */
export function marketRange(low: number | null, high: number | null, currency = "USD") {
  if (low == null && high == null) return null;
  if (low != null && high != null && Math.round(low) !== Math.round(high)) {
    return `${money(Math.round(low), currency)}–${money(Math.round(high), currency)}`;
  }
  return money(Math.round((low ?? high)!), currency);
}

export function relativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function clockTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
