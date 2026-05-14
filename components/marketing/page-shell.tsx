/**
 * Shared page shell for audit / operator pages.
 *
 * Visual rules:
 *   - Same max-w-3xl single column as the landing
 *   - py-24 top spacing (clears the fixed h-14 nav with breathing room)
 *   - Section index ("01") in warm-400 tabular, kicker in small uppercase
 *   - h1 in display serif, max ~20ch for legibility
 *   - Lede in bone-400, max-w-2xl
 *
 * Used by /dashboard, /journal, /research, /memory-graph, /admin, /setup
 * so every internal surface inherits identical chrome.
 */

import type { ReactNode } from "react";
import { Nav } from "./nav";
import { SiteFooter } from "./site-footer";

interface PageShellProps {
  /** Small uppercase eyebrow label, e.g. "DASHBOARD / LIVE STATE". */
  kicker: string;
  /** The h1 — keep short, ~6 words. */
  title: ReactNode;
  /** One-paragraph subhead. Optional. */
  lede?: ReactNode;
  children: ReactNode;
}

export function PageShell({ kicker, title, lede, children }: PageShellProps) {
  return (
    <main className="relative min-h-dvh bg-ink-950 text-bone-200">
      <Nav />
      <section className="px-5 md:px-8 pt-32 pb-24">
        <div className="max-w-3xl mx-auto">
          <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em] mb-4">
            {kicker}
          </p>
          <h1 className="text-display text-[32px] sm:text-[44px] leading-[1.08] tracking-tight text-bone-50 mb-6 max-w-[20ch]">
            {title}
          </h1>
          {lede && (
            <p className="text-[15px] sm:text-base text-bone-400 leading-relaxed max-w-2xl mb-14">
              {lede}
            </p>
          )}
          {children}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
