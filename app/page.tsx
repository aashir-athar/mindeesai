/**
 * Landing — editorial dossier.
 *
 *   Hero            — single typographic statement + dossier strip
 *   01 / Mechanism  — how the model rewires itself, four moves
 *   02 / Specs      — architecture spec sheet
 *   03 / Features   — horizontal capability canvas
 *   04 / Philosophy — pull quote
 *   05 / Start      — primary CTA
 *   Footer          — Swiss-grid colophon
 */

import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Nav } from "@/components/marketing/nav";
import { AuroraWash } from "@/components/marketing/aurora-wash";
import { DossierStrip } from "@/components/marketing/dossier-strip";
import { SectionHeading } from "@/components/marketing/section-heading";
import { SpecsTable } from "@/components/marketing/specs-table";
import { PullQuote } from "@/components/marketing/pull-quote";
import { FeatureCanvas } from "@/components/marketing/feature-canvas";
import { SiteFooter } from "@/components/marketing/site-footer";
import {
  masthead,
  hero,
  sections,
  philosophyQuote,
} from "@/lib/psychology/copywriting";

// lucide-react v1 dropped brand icons; render GitHub inline.
function GithubIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.17a11 11 0 0 1 2.88-.39c.98 0 1.96.13 2.88.39 2.2-1.48 3.17-1.17 3.17-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.25 5.65.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <main className="relative isolate min-h-dvh">
      <Nav />

      {/* ───────────── HERO ───────────── */}
      <section className="relative pt-40 md:pt-56 pb-28 md:pb-32">
        <AuroraWash />

        <div className="section !pt-0 !pb-0">
          <div className="grid grid-cols-12 gap-y-12 md:gap-x-12">
            <div className="col-span-12 md:col-span-9">
              <p className="text-eyebrow reveal">
                {masthead.volume} &nbsp;/&nbsp; {hero.kicker} &nbsp;/&nbsp; {masthead.status}
              </p>

              <h1 className="text-display-xl mt-8 reveal reveal-delay-1 max-w-[18ch]">
                {hero.title.line1}{" "}
                <em className="em-warm not-italic block md:inline">{hero.title.em}</em>
              </h1>

              <p className="mt-10 max-w-2xl text-lg md:text-xl text-bone-200 leading-relaxed reveal reveal-delay-2">
                {hero.lede}
              </p>

              <div className="mt-12 flex flex-wrap items-center gap-3 reveal reveal-delay-3">
                <Link href="/chat" className="btn btn-primary">
                  <Sparkles className="size-4" />
                  {hero.ctaPrimary}
                  <ArrowUpRight className="size-4" />
                </Link>
                <Link
                  href="https://github.com/aashir-athar/mindeesai"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost"
                >
                  <GithubIcon className="size-4" />
                  {hero.ctaSecondary}
                </Link>
              </div>
            </div>

            <aside className="col-span-12 md:col-span-3 md:pt-2 reveal reveal-delay-3">
              <p className="text-eyebrow mb-4">VITALS</p>
              <ul className="flex flex-col gap-3 text-sm text-bone-300">
                <Vital label="MIT" value="Open-source" />
                <Vital label="0¢" value="Free to host" />
                <Vital label="5 min" value="Self-improvement tick" />
                <Vital label="8d" value="Mood tensor" />
                <Vital label="16d" value="User model" />
                <Vital label="42×" value="Built-in skills + tensors" />
              </ul>
            </aside>
          </div>

          <div className="mt-20 reveal reveal-delay-4">
            <DossierStrip />
          </div>
        </div>
      </section>

      <div className="rule-fade mx-auto max-w-6xl" />

      {/* ───────────── 01 / MECHANISM ───────────── */}
      <section id="how" className="section">
        <SectionHeading
          index={sections.how.index}
          kicker={sections.how.kicker}
          title={sections.how.title}
          lede={sections.how.lede}
        />

        <div className="mt-16 grid md:grid-cols-2 gap-x-12 gap-y-14">
          {sections.how.steps.map((s) => (
            <article key={s.n} className="flex gap-8">
              <p className="text-display text-5xl md:text-6xl text-bone-50 leading-none w-16 shrink-0">
                {s.n}
              </p>
              <div className="flex flex-col gap-3 pt-2">
                <h3 className="text-display text-2xl md:text-3xl">{s.t}</h3>
                <p className="text-bone-300 leading-relaxed text-[15px]">{s.d}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="rule-fade mx-auto max-w-6xl" />

      {/* ───────────── 02 / SPECS ───────────── */}
      <section id="specs" className="section">
        <div className="grid-editorial">
          <div>
            <SectionHeading
              index={sections.specs.index}
              kicker={sections.specs.kicker}
              title={sections.specs.title}
              lede={sections.specs.lede}
            />
          </div>
          <div>
            <SpecsTable rows={SPEC_ROWS} />
          </div>
        </div>
      </section>

      <div className="rule-fade mx-auto max-w-6xl" />

      {/* ───────────── 03 / FEATURES ───────────── */}
      <section id="features" className="section">
        <SectionHeading
          index={sections.features.index}
          kicker={sections.features.kicker}
          title={sections.features.title}
          lede={sections.features.lede}
        />
        <div className="-mx-[clamp(1.5rem,5vw,3rem)]">
          <FeatureCanvas />
        </div>
      </section>

      <div className="rule-fade mx-auto max-w-6xl" />

      {/* ───────────── 04 / PHILOSOPHY ───────────── */}
      <section id="philosophy" className="section">
        <div className="grid-editorial">
          <div>
            <p className="text-eyebrow">{sections.philosophy.index} / {sections.philosophy.kicker}</p>
            <h2 className="text-display-md mt-4">{sections.philosophy.title}</h2>
          </div>
          <div className="pt-2">
            <PullQuote attribution={philosophyQuote.attribution}>
              {philosophyQuote.body}
            </PullQuote>
          </div>
        </div>
      </section>

      <div className="rule-fade mx-auto max-w-6xl" />

      {/* ───────────── 05 / START ───────────── */}
      <section id="start" className="section">
        <div className="glass-strong rounded-3xl p-10 md:p-16 relative overflow-hidden">
          <div className="absolute -top-32 -right-32 size-96 rounded-full bg-warm-400/10 blur-3xl pointer-events-none" aria-hidden />
          <p className="text-eyebrow relative">{sections.start.index} / {sections.start.kicker}</p>
          <h2 className="text-display-md mt-4 max-w-3xl relative">{sections.start.title}</h2>
          <p className="text-bone-300 leading-relaxed mt-6 max-w-xl relative">{sections.start.lede}</p>
          <div className="mt-10 flex flex-wrap gap-3 relative">
            <Link
              href="https://github.com/aashir-athar/mindeesai"
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
            >
              <GithubIcon className="size-4" />
              Clone the repository
              <ArrowUpRight className="size-4" />
            </Link>
            <Link href="/chat" className="btn btn-ghost">
              Talk to Mindees first
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <li className="grid grid-cols-12 items-baseline gap-3 py-2 border-t border-white/[0.05] first:border-t-0">
      <span className="col-span-4 text-tabular text-warm-400 text-base">{label}</span>
      <span className="col-span-8 text-bone-200">{value}</span>
    </li>
  );
}

/** Honest, auditable architecture spec sheet. Each row maps to source code. */
const SPEC_ROWS = [
  { label: "MODEL CLASS",     value: "Decoder-only transformer",  detail: "RoPE · RMSNorm · SwiGLU · GQA · tied embeddings" },
  { label: "VARIANTS",        value: "nano · small · base · large · moe-small · moe-base", detail: "12M → 1.3B params" },
  { label: "SPARSITY",        value: "Mixture of Experts, top-K", detail: "8 / 16 experts, top-2 routing, load-balance aux loss" },
  { label: "ATTENTION",       value: "Multi-head Latent Attention", detail: "DeepSeek-V3 compressed-KV, ~10× cache reduction" },
  { label: "AUX HEADS",       value: "Multi-Token Prediction",    detail: "Depth 2–3 — denser training signal, speculative drafts" },
  { label: "ONLINE TRAINING", value: "AdamW + LoRA",              detail: "Every 5 min via /api/cron/self-improve" },
  { label: "RL",              value: "GRPO",                      detail: "Group Relative Policy Optimization — no reward model" },
  { label: "ALIGNMENT",       value: "Constitutional self-critique", detail: "Critic-gated refinement loop" },
  { label: "PERSONA TENSORS", value: "Mood 8d · User 16d · Relationship 4d", detail: "Drift detector + curiosity gap + reward predictor" },
  { label: "MEMORY",          value: "LanceDB · JSONL · Graph",   detail: "Vector recall + replay buffer + entity graph" },
  { label: "RESEARCH",        value: "Tavily / Exa · Firecrawl / Jina", detail: "Free-tier autonomous search + extraction" },
  { label: "CONNECTORS",      value: "Drop-folder plugins",       detail: "6 built-in: web-search, web-crawl, calculator, code-exec, file-read, reflect" },
  { label: "EVAL",            value: "Perplexity · Reasoning · Recall", detail: "Regression-gated rollback after every cron tick" },
  { label: "RUNTIME",         value: "TypeScript · WebGPU",       detail: "Pure-JS CPU fallback; Python pretraining in scripts/train/" },
  { label: "DEPLOY",          value: "Vercel · self-host · air-gapped", detail: "MIT-licensed, MIT-everything" },
];
