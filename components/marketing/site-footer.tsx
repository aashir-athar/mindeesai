/**
 * Site footer — minimal Claude/Grok aesthetic.
 *
 * Single thin border on top, single row of slim links, copyright on the
 * left, version on the right. No Swiss-grid columns, no link clusters
 * — just the few things the visitor actually needs.
 */

import Link from "next/link";
import { Monogram } from "./monogram";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="inline-flex items-center gap-2.5">
          <Monogram size={20} />
          <span className="text-[13px] text-bone-300">MindeesAI</span>
          <span className="text-[11px] text-bone-600 ml-1">— MIT, open source</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-bone-400">
          <FooterLink href="/chat">Chat</FooterLink>
          <FooterLink href="/dashboard">Dashboard</FooterLink>
          <FooterLink href="/setup">Setup</FooterLink>
          <FooterLink href="https://github.com/aashir-athar/mindeesai">GitHub</FooterLink>
          <FooterLink href="https://x.com/aashirathar">X</FooterLink>
        </nav>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="hover:text-bone-50 transition-colors"
    >
      {children}
    </Link>
  );
}
