"use client";

/**
 * Top navigation — minimal Claude/Grok-style.
 *
 * Layout: logomark + wordmark on the left, slim text-only links centred
 * on desktop, single primary CTA on the right. Border appears on scroll
 * only. No fixed background pill, no decorative kerning eyebrow.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Monogram } from "./monogram";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-[border-color,background-color] duration-200 ${
        scrolled
          ? "bg-ink-950/85 backdrop-blur-xl border-b border-white/[0.05]"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <nav className="mx-auto max-w-6xl px-5 md:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <Monogram size={22} />
          <span className="text-[15px] font-medium tracking-tight text-bone-50">MindeesAI</span>
        </Link>

        <div className="hidden md:flex items-center gap-7 text-[13px] text-bone-400">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/journal">Journal</NavLink>
          <NavLink href="/research">Research</NavLink>
          <NavLink href="/memory-graph">Graph</NavLink>
          <NavLink href="/setup">Setup</NavLink>
        </div>

        <Link
          href="/chat"
          className="text-[13px] font-medium text-ink-950 bg-bone-50 hover:bg-white rounded-lg px-3.5 py-1.5 transition-colors"
        >
          Open chat
        </Link>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="hover:text-bone-50 transition-colors">
      {children}
    </Link>
  );
}
