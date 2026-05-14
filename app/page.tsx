/**
 * Landing — minimal Claude/Grok aesthetic.
 *
 * Pattern (validated against the ui-ux-pro-max skill's "Minimal Single
 * Column" pattern): hero → 3 benefits → how → tensors digest → CTA →
 * footer. Single max-w-3xl column, generous py-24 between sections,
 * single warm-400 accent used sparingly, dark mode native.
 *
 * Anti-patterns avoided:
 *   - No decorative gradients or glass-morphism
 *   - No multi-column grids cluttering the eye
 *   - No 20-item feature lists on the front page (that lives on /dashboard)
 *   - No emoji icons; all icons are SVG via lucide
 */

import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Monogram } from "@/components/marketing/monogram";

export const dynamic = "force-static";

export default function LandingPage() {
  return (
    <main className="relative min-h-dvh bg-ink-950 text-bone-200">
      <Nav />

      {/* ───── HERO ───── */}
      <section className="pt-40 sm:pt-48 pb-24 px-5 md:px-8">
        <div className="max-w-3xl mx-auto">
          <Monogram size={92} />
          <h1 className="mt-10 text-display text-[44px] sm:text-[64px] leading-[1.04] tracking-tight text-bone-50 max-w-[18ch]">
            An AI that gets <em className="not-italic text-warm-400">measurably</em> better the more you talk to it.
          </h1>
          <p className="mt-7 text-[17px] sm:text-lg text-bone-400 leading-relaxed max-w-2xl">
            MindeesAI is a native, self-training open-source language model. Every chat turn becomes training data. Every five minutes the model rewires itself on what you said. The reply you get tomorrow is shaped by the question you ask today.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/chat"
              className="cursor-pointer text-[14px] font-medium text-ink-950 bg-bone-50 hover:bg-white rounded-lg px-5 py-2.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone-50/40"
            >
              Open chat
            </Link>
            <Link
              href="https://github.com/aashir-athar/mindeesai"
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer text-[14px] text-bone-200 border border-white/[0.10] hover:bg-white/[0.04] hover:border-white/[0.18] rounded-lg px-5 py-2.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone-50/40"
            >
              View on GitHub
            </Link>
          </div>
          <p className="mt-14 text-[12px] text-bone-600 font-mono tracking-wide">
            MIT licensed  ·  free to host  ·  zero vendor lock-in
          </p>
        </div>
      </section>

      <Divider />

      {/* ───── 01 / THREE BENEFITS ───── */}
      <Section index="01" title="Three things make it different.">
        <div className="space-y-12">
          {BENEFITS.map((b) => (
            <article key={b.title}>
              <h3 className="text-display text-2xl sm:text-3xl text-bone-50 leading-tight tracking-tight">
                {b.title}
              </h3>
              <p className="mt-3 text-[15px] sm:text-base text-bone-400 leading-relaxed max-w-xl">
                {b.body}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Divider />

      {/* ───── 02 / HOW IT WORKS ───── */}
      <Section index="02" title="How it works.">
        <ol className="space-y-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-6">
              <span className="text-warm-400 text-tabular text-[12px] mt-1.5 shrink-0 w-7 tracking-wider">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-1">
                <h3 className="text-display text-xl sm:text-2xl text-bone-50 leading-snug tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-2 text-[15px] text-bone-400 leading-relaxed max-w-xl">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Divider />

      {/* ───── 03 / WHAT IT REMEMBERS (digest, not exhaustive) ───── */}
      <Section index="03" title="It remembers everything about you.">
        <p className="text-[15px] sm:text-base text-bone-400 leading-relaxed max-w-xl mb-10">
          Twenty persistent state tensors update every turn. A handful of the ones that matter most are below — the full set is auditable at{" "}
          <Link href="/dashboard" className="cursor-pointer text-bone-200 underline decoration-warm-400/40 underline-offset-4 hover:decoration-warm-400 transition-colors duration-200">
            /dashboard
          </Link>
          .
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          {TENSORS_DIGEST.map((t) => (
            <div key={t.name} className="border-t border-white/[0.06] pt-3.5">
              <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em]">{t.shape}</p>
              <h4 className="mt-1 text-bone-100 text-[15px] tracking-tight">{t.name}</h4>
              <p className="mt-1 text-[13px] text-bone-500 leading-relaxed">{t.what}</p>
            </div>
          ))}
        </div>
      </Section>

      <Divider />

      {/* ───── 04 / GET STARTED ───── */}
      <section className="px-5 md:px-8 py-24">
        <div className="max-w-3xl mx-auto">
          <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em]">04 — Get started</p>
          <h2 className="mt-4 text-display text-[32px] sm:text-[44px] leading-[1.08] tracking-tight text-bone-50 max-w-[22ch]">
            One click to deploy. One click to talk.
          </h2>
          <p className="mt-6 text-[15px] sm:text-base text-bone-400 leading-relaxed max-w-2xl">
            Hosted free on Vercel Hobby. Self-improvement cron free via cron-job.org. Pretraining free on GitHub Actions CPU minutes. The whole loop runs on zero dollars.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="https://github.com/aashir-athar/mindeesai"
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer text-[14px] font-medium text-ink-950 bg-bone-50 hover:bg-white rounded-lg px-5 py-2.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone-50/40"
            >
              Clone the repository
            </Link>
            <Link
              href="/chat"
              className="cursor-pointer text-[14px] text-bone-200 border border-white/[0.10] hover:bg-white/[0.04] hover:border-white/[0.18] rounded-lg px-5 py-2.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone-50/40"
            >
              Try it first
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

// ─── Section primitive ─────────────────────────────────────────────────────

function Section({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 md:px-8 py-24">
      <div className="max-w-3xl mx-auto">
        <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em] mb-4">
          {index}
        </p>
        <h2 className="text-display text-[32px] sm:text-[44px] leading-[1.08] tracking-tight text-bone-50 mb-14 max-w-[20ch]">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function Divider() {
  return (
    <div className="px-5 md:px-8">
      <div className="max-w-3xl mx-auto border-t border-white/[0.06]" />
    </div>
  );
}

// ─── Data ──────────────────────────────────────────────────────────────────

const BENEFITS = [
  {
    title: "You own the weights.",
    body: "Most AI products are wrappers around someone else's model. MindeesAI is the model. Decoder-only transformer, BPE tokenizer, AdamW optimizer, gradient descent — all of it lives in this repository under MIT license. Vendor disappears? Doesn't matter. The weights are on your disk.",
  },
  {
    title: "Every conversation makes it better.",
    body: "Each turn is logged as training data. A cron job runs gradient descent every five minutes on what you said. A weekly retrain folds your chat into the next checkpoint. The model talking to you next week was shaped by the questions you asked this week.",
  },
  {
    title: "Zero dollars to run.",
    body: "Vercel Hobby for hosting. Cron-job.org for the 5-minute loop. GitHub Actions free CPU for pretraining. Free-tier providers (Groq, Gemini Flash, JINA, DuckDuckGo, Wikipedia, arXiv, Reddit) for everything that touches the open web. The whole stack runs on no card.",
  },
];

const STEPS = [
  {
    title: "Every chat turn becomes training data.",
    body: "Each conversation is logged with the system prompt, your message, and the assistant reply. The corpus grows automatically — every turn appends one row, weighted 4× during pretraining.",
  },
  {
    title: "Every five minutes, the model improves.",
    body: "A cron tick reflects on recent threads, runs a gradient-descent step on the live model, autonomously researches topics it was uncertain about, and writes a private journal entry to its future self.",
  },
  {
    title: "Every week, the full retrain runs.",
    body: "GitHub Actions trains the native transformer from scratch on the seed corpus, the live distill corpus, and a curated public dialogue dataset. The new checkpoint uploads to Vercel Blob. Cold start hydrates the new weights.",
  },
  {
    title: "One click, and it's your model.",
    body: "Once a checkpoint is on disk, /admin flips USE_NATIVE_MODEL on. The chat starts routing through your own weights. No more vendor API in the path.",
  },
];

const TENSORS_DIGEST = [
  { name: "Mood",                shape: "8-DIM",   what: "Curiosity · warmth · playfulness · focus · wonder · frustration · calm · confidence" },
  { name: "User model",          shape: "16-DIM",  what: "Terseness, formality, technical depth, humour — adapts slowly so identity doesn't flicker" },
  { name: "Theory of mind",      shape: "MAP",     what: "What you know · don't know · half-know — prevents over- and under-explaining" },
  { name: "Topic affinity",      shape: "MAP",     what: "Which subjects light you up vs. close you off — learned from reply-length deltas" },
  { name: "Self-correction",     shape: "LOG",     what: "Every time you said 'no, it's X' — surfaced as 'don't repeat this' in future prompts" },
  { name: "Delights",            shape: "LOG",     what: "Moments that landed — laughter, gratitude, affirmation. Mindees can callback them later" },
  { name: "Inner voice",         shape: "ROLLING", what: "Private 'I notice they're rushed; reply should be short' stream that shapes the tone" },
  { name: "Knowledge graph",     shape: "TRIPLES", what: "Auto-extracted facts about you, your projects, your preferences" },
];
