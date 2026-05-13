/**
 * Landing page — Awwwards-tier dark cinematic, editorial typography, horizontal
 * scroll feature canvas.
 *
 * Sections (in order):
 *   1. Hero          — bold display headline + value prop + primary CTA
 *   2. Live status   — proves the model is actually training right now
 *   3. How it works  — three-step explainer
 *   4. Features      — horizontally scrollable canvas of feature cards
 *   5. Philosophy    — text block with the design/engineering ethos
 *   6. CTA           — secondary call to clone the repo
 *   7. Footer        — minimal, with GitHub link
 */

import Link from "next/link";
import { headlines, lossAversion, authority, reciprocity, specificity } from "@/lib/psychology/copywriting";
import { HeroOrb } from "@/components/marketing/hero-orb";
import { LiveStatus } from "@/components/marketing/live-status";
import { FeatureCanvas } from "@/components/marketing/feature-canvas";
import { ArrowUpRight, GitBranch, Sparkles } from "lucide-react";

// lucide-react no longer ships a Github brand icon; render inline SVG instead.
function GithubIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.17a11 11 0 0 1 2.88-.39c.98 0 1.96.13 2.88.39 2.2-1.48 3.17-1.17 3.17-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.25 5.65.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
void GitBranch;

export default function LandingPage() {
  return (
    <main className="relative isolate min-h-dvh overflow-x-clip">
      {/* Top nav */}
      <header className="fixed top-0 inset-x-0 z-50">
        <nav className="mx-auto max-w-7xl px-6 md:px-10 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="size-2 rounded-full bg-aurora-400 pulse-dot" aria-hidden />
            <span className="text-sm tracking-tight font-medium">MindeesAI</span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm text-bone-300">
            <Link href="#how" className="hover:text-bone-100 transition-colors">How it works</Link>
            <Link href="#features" className="hover:text-bone-100 transition-colors">Features</Link>
            <Link href="#philosophy" className="hover:text-bone-100 transition-colors">Philosophy</Link>
            <Link
              href="https://github.com/aashir-athar/mindeesai"
              className="inline-flex items-center gap-1.5 hover:text-bone-100 transition-colors"
              target="_blank"
              rel="noreferrer"
            >
              <GithubIcon className="size-4" />
              GitHub
            </Link>
          </div>
          <Link
            href="/chat"
            className="text-sm px-4 py-2 rounded-full glass hover:bg-white/[0.05] transition-colors inline-flex items-center gap-1.5"
          >
            Open chat <ArrowUpRight className="size-3.5" />
          </Link>
        </nav>
      </header>

      {/* HERO */}
      <section className="relative pt-40 md:pt-52 pb-24 md:pb-32 mx-auto max-w-7xl px-6 md:px-10">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <HeroOrb />
        </div>

        <p className="text-eyebrow reveal-up">{headlines.trustBar}</p>

        <h1 className="text-display text-5xl md:text-7xl lg:text-[5.5rem] mt-6 max-w-5xl reveal-up" style={{ animationDelay: "60ms" }}>
          An AI that <em className="aurora-grad not-italic">gets smarter</em>{" "}
          every five minutes —{" "}
          and remembers <em className="font-display italic text-bone-300">you</em> forever.
        </h1>

        <p className="mt-8 max-w-2xl text-lg md:text-xl text-bone-300 leading-relaxed reveal-up" style={{ animationDelay: "120ms" }}>
          MindeesAI ships its own transformer architecture, its own tokenizer, and its own weights — and runs
          gradient descent on those weights every five minutes, on its own conversations. No vendor. No
          subscription. No forgetting.
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-4 reveal-up" style={{ animationDelay: "180ms" }}>
          <Link
            href="/chat"
            className="group inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-bone-50 text-ink-950 font-medium hover:bg-white transition-colors"
          >
            <Sparkles className="size-4" />
            Start a conversation
            <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <Link
            href="https://github.com/aashir-athar/mindeesai"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full glass hover:bg-white/[0.05] transition-colors"
          >
            <GithubIcon className="size-4" />
            Star on GitHub
          </Link>
        </div>

        {/* Live status under hero */}
        <div className="mt-16 reveal-up" style={{ animationDelay: "240ms" }}>
          <LiveStatus />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="relative py-32 mx-auto max-w-7xl px-6 md:px-10">
        <p className="text-eyebrow">How it works</p>
        <h2 className="text-display text-4xl md:text-6xl mt-4 max-w-4xl">
          The model trains itself. <span className="text-bone-500">In four moves.</span>
        </h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
          {[
            { n: "01", t: "Talk", d: "Every conversation is appended to JSONL and embedded into the long-term vector store." },
            { n: "02", t: "Reflect", d: "Every 5 minutes the model reads its recent threads and distils high-confidence insights." },
            { n: "03", t: "Train", d: "AdamW + LoRA gradient step on the model's own weights — the actual neural network changes." },
            { n: "04", t: "Improve", d: "The next message you send hits an objectively smarter model. Loss curves recorded in the log." },
          ].map((s, i) => (
            <article
              key={s.n}
              className="glass rounded-2xl p-6 reveal-up"
              style={{ animationDelay: `${100 + i * 80}ms` }}
            >
              <p className="font-mono text-xs text-aurora-400">{s.n}</p>
              <h3 className="text-display text-2xl mt-4">{s.t}</h3>
              <p className="text-bone-300 mt-3 text-[15px] leading-relaxed">{s.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* FEATURES (horizontal scroll canvas) */}
      <section id="features" className="relative py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <p className="text-eyebrow">What it does</p>
          <h2 className="text-display text-4xl md:text-6xl mt-4 max-w-4xl">
            Native everything. <span className="text-bone-500">Including the brain.</span>
          </h2>
        </div>
        <FeatureCanvas />
      </section>

      {/* PHILOSOPHY */}
      <section id="philosophy" className="relative py-32 mx-auto max-w-4xl px-6 md:px-10">
        <p className="text-eyebrow">Philosophy</p>
        <h2 className="text-display text-3xl md:text-5xl mt-4">
          Trust is built by <em className="aurora-grad not-italic">showing your work</em>.
        </h2>
        <div className="mt-12 space-y-7 text-lg text-bone-300 leading-[1.7]">
          <p>{lossAversion.forgetting}</p>
          <p>{authority.citationsAreFirstClass}</p>
          <p>{authority.reflectionLog}</p>
          <p>{reciprocity.freeTier}</p>
          <p className="text-bone-500 italic">{specificity.cadence}</p>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-32 mx-auto max-w-7xl px-6 md:px-10">
        <div className="glass-strong rounded-3xl p-10 md:p-16 relative overflow-hidden">
          <div className="absolute -top-32 -right-32 size-96 rounded-full bg-aurora-500/20 blur-3xl pointer-events-none" aria-hidden />
          <p className="text-eyebrow relative">Ship it</p>
          <h2 className="text-display text-3xl md:text-5xl mt-4 max-w-2xl relative">
            One repo. One clone. One model that <em className="not-italic aurora-grad">never stops learning</em>.
          </h2>
          <div className="mt-10 flex flex-wrap gap-4 relative">
            <Link
              href="https://github.com/aashir-athar/mindeesai"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-bone-50 text-ink-950 font-medium hover:bg-white transition-colors"
            >
              <GithubIcon className="size-4" />
              Clone the repo
              <ArrowUpRight className="size-4" />
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full glass hover:bg-white/[0.05] transition-colors"
            >
              Try it first
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative border-t border-white/[0.06] mt-20">
        <div className="mx-auto max-w-7xl px-6 md:px-10 py-12 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-bone-500">
            Built by{" "}
            <a href="https://github.com/aashir-athar" className="text-bone-300 hover:text-bone-100" target="_blank" rel="noreferrer">
              Aashir Athar
            </a>{" "}
            · MIT License · 100% open-source
          </p>
          <p className="text-xs font-mono text-bone-500">v0.1.0</p>
        </div>
      </footer>
    </main>
  );
}
