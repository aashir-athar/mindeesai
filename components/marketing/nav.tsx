"use client";

/**
 * Top navigation — editorial, minimal.
 * Logomark + wordmark on the left, anchor nav in the centre on desktop,
 * primary CTA on the right. Hairline border on scroll.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Monogram } from "./monogram";
import { ArrowUpRight } from "lucide-react";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${scrolled ? "bg-ink-950/70 backdrop-blur-xl border-b border-white/[0.05]" : ""}`}>
      <nav className="mx-auto max-w-7xl px-6 md:px-10 py-4 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2.5 group">
          <Monogram size={22} className="transition-transform group-hover:rotate-[-4deg]" />
          <span className="text-sm tracking-tight font-medium text-bone-50">MindeesAI</span>
          <span className="text-eyebrow !text-bone-500 ml-2 hidden sm:inline">VOL.01 / 2026</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-bone-300">
          <NavLink href="/#how">How</NavLink>
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/journal">Journal</NavLink>
          <NavLink href="/research">Research</NavLink>
          <NavLink href="/memory-graph">Graph</NavLink>
        </div>

        <Link href="/chat" className="btn btn-ghost text-sm">
          Open chat
          <ArrowUpRight className="size-3.5" />
        </Link>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="hover:text-bone-50 transition-colors relative after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-px after:bg-warm-400/0 hover:after:bg-warm-400/60 after:transition-colors"
    >
      {children}
    </Link>
  );
}
