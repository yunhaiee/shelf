import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"),
  title: {
    default: "Shelf — make any small shop buyable by AI",
    template: "%s — Shelf",
  },
  description:
    "Paste your shop link. Shelf turns it into a catalog AI assistants can search and buy from, with PayPal checkout that pays you directly.",
  openGraph: {
    title: "Shelf — make any small shop buyable by AI",
    description: "Independent shops, searchable and buyable inside AI assistants. Checkout with PayPal.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
