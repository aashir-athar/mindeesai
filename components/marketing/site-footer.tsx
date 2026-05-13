/**
 * Site footer — minimal Swiss grid.
 *   Column 1: Identity / colophon
 *   Column 2: Product (links)
 *   Column 3: Source (links)
 *   Column 4: Contact / social
 *
 * No marketing fluff. Just navigation + masthead.
 */

import Link from "next/link";
import { Monogram } from "./monogram";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06] mt-20">
      <div className="mx-auto max-w-7xl px-6 md:px-10 py-16 grid grid-cols-12 gap-10">
        <div className="col-span-12 md:col-span-5 flex flex-col gap-6">
          <div className="inline-flex items-center gap-2.5">
            <Monogram size={24} />
            <span className="text-base tracking-tight text-bone-50 font-medium">MindeesAI</span>
          </div>
          <p className="text-bone-300 text-sm leading-relaxed max-w-md">
            A native, self-training open-source language model.
            Built in the open by{" "}
            <a href="https://github.com/aashir-athar" className="text-bone-100 underline decoration-warm-400/40 underline-offset-4 hover:decoration-warm-400 transition-colors">
              Aashir Athar
            </a>{" "}
            and contributors.
          </p>
          <p className="text-eyebrow !text-bone-500">
            VOL.01 / 2026 — MIT LICENSED
          </p>
        </div>

        <FooterCol title="Product">
          <FooterLink href="/chat">Chat</FooterLink>
          <FooterLink href="/api/health">Live status</FooterLink>
          <FooterLink href="/api/benchmark">Benchmark</FooterLink>
        </FooterCol>

        <FooterCol title="Source">
          <FooterLink href="https://github.com/aashir-athar/mindeesai">Repository</FooterLink>
          <FooterLink href="https://github.com/aashir-athar/mindeesai/issues">Issues</FooterLink>
          <FooterLink href="https://github.com/aashir-athar/mindeesai/blob/main/docs/ARCHITECTURE.md">Architecture</FooterLink>
          <FooterLink href="https://github.com/aashir-athar/mindeesai/blob/main/docs/CONNECTORS.md">Connectors</FooterLink>
        </FooterCol>

        <FooterCol title="Author">
          <FooterLink href="https://github.com/aashir-athar">GitHub</FooterLink>
          <FooterLink href="https://x.com/aashirathar">X / Twitter</FooterLink>
          <FooterLink href="https://www.linkedin.com/in/aashirathar">LinkedIn</FooterLink>
        </FooterCol>
      </div>

      <div className="border-t border-white/[0.05]">
        <div className="mx-auto max-w-7xl px-6 md:px-10 py-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-eyebrow !text-bone-500">
            © 2026 — Set in <span className="text-bone-300">Fraunces</span> &amp; <span className="text-bone-300">Geist</span>
          </p>
          <p className="text-tabular text-eyebrow !text-bone-500">v0.2.0</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="col-span-6 md:col-span-2 flex flex-col gap-4">
      <p className="text-eyebrow">{title}</p>
      <ul className="flex flex-col gap-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  return (
    <li>
      <Link
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="text-bone-300 hover:text-bone-50 transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}
