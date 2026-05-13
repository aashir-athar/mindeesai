"use client";

/**
 * The horizontally-scrollable feature canvas — the "Awwwards moment" of the page.
 *
 * Uses native CSS scroll-snap (no JS) so it works perfectly on mobile and via
 * mouse-wheel-horizontal on trackpads. Cards reveal on scroll via the standard
 * `reveal-up` keyframes from globals.css.
 */

import { Brain, GitBranch, Library, ScanSearch, Plug, ShieldCheck, Workflow, Cpu } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Native transformer",
    body: "Decoder-only architecture with RoPE, RMSNorm, SwiGLU, and grouped-query attention. The weights live in this repo.",
  },
  {
    icon: GitBranch,
    title: "5-minute gradient ticks",
    body: "AdamW + LoRA online learning. Every cron tick computes real gradients on real conversations. No prompt-fiddling pretending to be improvement.",
  },
  {
    icon: Library,
    title: "Persistent vector memory",
    body: "LanceDB-backed semantic recall across every conversation you've ever had. Promoted insights are embedded and surface again automatically.",
  },
  {
    icon: ScanSearch,
    title: "Autonomous web research",
    body: "Tavily + Firecrawl. The model calls the search tool when it needs to. You see the citations inline; hover any [N] to verify.",
  },
  {
    icon: Plug,
    title: "Drop-folder connectors",
    body: "Skills are a folder with a manifest. Add one, restart, the model can use it. No router edits. No registry. No mystery.",
  },
  {
    icon: ShieldCheck,
    title: "Auditable improvement log",
    body: "Every weight update lands in an append-only JSONL. Roll back any improvement, anytime. Trust is built by showing your work.",
  },
  {
    icon: Workflow,
    title: "Curriculum self-play",
    body: "Where the model is uncertain, it generates questions for itself, answers them, and trains on the critic-approved subset.",
  },
  {
    icon: Cpu,
    title: "Runs on your laptop",
    body: "Pure-TypeScript inference with optional WebGPU acceleration. No CUDA dependency. Zero outbound network calls during a chat.",
  },
];

export function FeatureCanvas() {
  return (
    <div className="horizontal-scroll mt-10">
      {features.map((f, i) => (
        <article
          key={f.title}
          className="glass rounded-3xl p-7 w-[20rem] min-w-[20rem] md:w-[24rem] md:min-w-[24rem] flex flex-col gap-4 reveal-up"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <f.icon className="size-5 text-aurora-400" />
          <h3 className="text-display text-2xl mt-2">{f.title}</h3>
          <p className="text-[15px] leading-relaxed text-bone-300">{f.body}</p>
        </article>
      ))}
      <div className="min-w-8" aria-hidden />
    </div>
  );
}
