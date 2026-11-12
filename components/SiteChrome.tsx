import Link from "next/link";

export function SiteHeader({ current }: { current?: "sell" | "connect" | "dash" }) {
  const nav = (href: string, label: string, key: string) => (
    <Link
      href={href}
      className={`text-[14px] no-underline transition-colors hover:text-accent ${current === key ? "text-ink" : "text-muted"}`}
      aria-current={current === key ? "page" : undefined}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b border-line">
      <div className="wrap flex h-16 items-center justify-between gap-6">
        <Link href="/" className="display text-[28px] leading-none no-underline" aria-label="Shelf home">
          Shelf
        </Link>
        <nav className="flex items-center gap-5 sm:gap-8" aria-label="Main">
          {nav("/sell", "Open your shop", "sell")}
          {nav("/#connect", "Connect to Claude", "connect")}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="wrap flex flex-col gap-3 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>Checkout by PayPal. Market prices by Channel3. Built for independent makers.</p>
        <p className="flex gap-5">
          <a href="/llms.txt" className="link text-muted">
            llms.txt
          </a>
          <Link href="/sell" className="link text-muted">
            Sell on Shelf
          </Link>
        </p>
      </div>
    </footer>
  );
}
