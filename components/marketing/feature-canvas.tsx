"use client";

/**
 * Horizontal feature canvas — refined editorial cards.
 *
 * Each card has:
 *   - kicker number (01..10) in mono warm
 *   - title in display serif
 *   - body in restrained sans
 *   - bottom: a single "specification line" with tabular values
 *
 * No icons (icons clutter editorial layouts). One accent line top-right.
 */

const features: Array<{
  n: string;
  title: string;
  body: string;
  spec: string;
}> = [
  {
    n: "01",
    title: "Native transformer",
    body:
      "Decoder-only architecture with RoPE, RMSNorm, SwiGLU, grouped-query attention, and tied embeddings. The weights live in this repository.",
    spec: "TS + WebGPU · LoRA online",
  },
  {
    n: "02",
    title: "Five-minute gradient",
    body:
      "Every five minutes, a cron job runs a real AdamW gradient step on real LoRA adapters. Not prompt rewriting. Actual neural-network learning.",
    spec: "AdamW + LoRA · DPO · GRPO",
  },
  {
    n: "03",
    title: "Persistent memory",
    body:
      "LanceDB-backed semantic recall across every conversation you have ever had. Promoted insights are embedded and resurface automatically.",
    spec: "Vector + graph + JSONL",
  },
  {
    n: "04",
    title: "Autonomous research",
    body:
      "Tavily and Firecrawl handle search and deep extraction. The model calls them when it decides to. You see every citation inline.",
    spec: "Tavily / Exa · Firecrawl / Jina",
  },
  {
    n: "05",
    title: "Drop-folder skills",
    body:
      "Add a connector by adding a folder. Manifest, handler, prompt. The orchestrator discovers it. No router edits. No registry.",
    spec: "6 built-in connectors",
  },
  {
    n: "06",
    title: "Auditable changes",
    body:
      "Every weight update appends to an immutable JSONL. Roll back any improvement tick. Trust is built by showing your work.",
    spec: "Append-only · regression-gated",
  },
  {
    n: "07",
    title: "Curriculum self-play",
    body:
      "Where the critic is uncertain, the model writes its own questions, answers them, and trains on the subset the critic approves.",
    spec: "Synthetic + critic-gated",
  },
  {
    n: "08",
    title: "Runs on your laptop",
    body:
      "Pure-TypeScript inference with optional WebGPU acceleration. No CUDA dependency. Zero outbound network calls during a chat.",
    spec: "CPU · WebGPU · Ollama",
  },
];

export function FeatureCanvas() {
  return (
    <div className="horizontal-scroll mt-12">
      {features.map((f, i) => (
        <article
          key={f.n}
          className="shrink-0 w-[22rem] md:w-[26rem] glass rounded-3xl p-8 reveal flex flex-col gap-6"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <header className="flex items-start justify-between">
            <span className="text-kicker">{f.n}</span>
            <span className="block h-px w-12 bg-warm-400/60" aria-hidden />
          </header>
          <h3 className="text-display text-2xl md:text-3xl">{f.title}</h3>
          <p className="text-bone-300 text-[15px] leading-relaxed">{f.body}</p>
          <footer className="mt-auto pt-6 border-t border-white/[0.05]">
            <p className="text-eyebrow text-tabular">{f.spec}</p>
          </footer>
        </article>
      ))}
      <div className="shrink-0 w-8" aria-hidden />
    </div>
  );
}
