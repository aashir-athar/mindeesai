import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { env } from "@/lib/env";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  // Fraunces is a variable font — `axes` requires no fixed weights.
  axes: ["SOFT", "WONK"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: {
    default: "MindeesAI — A native, self-training open-source AI",
    template: "%s · MindeesAI",
  },
  description:
    "MindeesAI is a free, open-source language model that trains itself every five minutes — on its own conversations, with its own weights. No vendor. No subscription. No forgetting.",
  applicationName: "MindeesAI",
  authors: [{ name: "Aashir Athar", url: "https://github.com/aashir-athar" }],
  creator: "Aashir Athar",
  publisher: "MindeesAI",
  keywords: [
    "open-source AI",
    "self-training language model",
    "continual learning",
    "native transformer",
    "LoRA online fine-tuning",
    "self-improving AI",
    "Next.js 16",
    "RAG",
    "DPO RLHF",
  ],
  openGraph: {
    type: "website",
    url: env.SITE_URL,
    title: "MindeesAI — A native, self-training open-source AI",
    description:
      "A native, self-training language model that gets smarter every five minutes. Open-source. MIT-licensed. Yours.",
    siteName: "MindeesAI",
    images: [{ url: "/og/default.png", width: 1200, height: 630, alt: "MindeesAI" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MindeesAI",
    description: "A native, self-training open-source AI.",
    creator: "@aashirathar",
    images: ["/og/default.png"],
  },
  // No explicit `icons` block — Next.js App Router auto-detects
  // app/icon.png (32x32) and app/apple-icon.png (180x180) and emits the
  // right <link> tags with hashed filenames for cache-busting. Both are
  // generated from public/assets/mind-logo.png via scripts/gen-favicons.mjs.
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#06060a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} dark`}
      suppressHydrationWarning
    >
      <body className="noise antialiased">
        {children}
      </body>
    </html>
  );
}
