/**
 * Editorial copywriting library.
 *
 * Principles applied:
 *  - Schwartz's 5 awareness levels — lead with the unaware ("an AI that
 *    remembers you forever") then escalate technical specificity for the
 *    most-aware reader.
 *  - AIDA on the primary CTA. FAB on every feature.
 *  - Anti-AI specificity: tabular numbers, named artefacts, real cadences.
 *  - Microcopy is intentional — every label is the label a journalist
 *    would write, not the label a marketer would.
 */

import type { ReactNode } from "react";

export const masthead = {
  volume: "VOL.01 / 2026",
  status: "Currently learning",
  positioning: "A self-training language model",
} as const;

export const hero = {
  kicker: "DOSSIER",
  title: {
    line1: "A language model",
    em: "that trains itself.",
  },
  lede:
    "MindeesAI ships its own transformer architecture, its own tokenizer, and its own weights — and runs gradient descent on those weights every five minutes, on its own conversations. No vendor. No subscription. No forgetting.",
  ctaPrimary: "Start a conversation",
  ctaSecondary: "Read the source",
} as const;

export interface SectionCopy {
  index: string;
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
}

export interface HowStep {
  n: string;
  t: string;
  d: string;
}

export const sections: {
  how: SectionCopy & { steps: HowStep[] };
  specs: SectionCopy;
  features: SectionCopy;
  philosophy: SectionCopy;
  start: SectionCopy;
} = {
  how: {
    index: "01",
    kicker: "MECHANISM",
    title: "The model rewires itself.",
    lede:
      "Every conversation becomes training signal. Every five minutes, that signal becomes a measurable change to the weights — recorded in an append-only log you can audit.",
    steps: [
      {
        n: "01",
        t: "Talk",
        d: "Every conversation is appended to JSONL and embedded into a long-term vector store.",
      },
      {
        n: "02",
        t: "Reflect",
        d: "Every five minutes the model reads its recent threads and distils high-confidence insights.",
      },
      {
        n: "03",
        t: "Train",
        d: "AdamW + LoRA gradient step on the model's own weights — the neural network changes, by definition.",
      },
      {
        n: "04",
        t: "Improve",
        d: "The next message hits a measurably smarter model. Loss curve recorded in data/improvement-log.jsonl.",
      },
    ],
  },
  specs: {
    index: "02",
    kicker: "SPECIFICATIONS",
    title: "An honest spec sheet.",
    lede: "What MindeesAI actually is, in numbers you can verify against the source.",
  },
  features: {
    index: "03",
    kicker: "CAPABILITIES",
    title: "Native everything. Including the brain.",
    lede:
      "Eight architectural decisions that distinguish a self-training model from an LLM wrapper. Scroll right.",
  },
  philosophy: {
    index: "04",
    kicker: "PHILOSOPHY",
    title: "The model is the product.",
  },
  start: {
    index: "05",
    kicker: "START",
    title: "One repository. One clone. One model that never stops learning.",
    lede:
      "Free. Open source. MIT-licensed. Self-hostable. You own the weights, the data, and the audit trail.",
  },
};

export const philosophyQuote = {
  body:
    "Trust is built by showing your work. Every factual answer carries citations. Every weight update lands in an append-only log you can audit and roll back. The model is not asked to be trusted — it earns it.",
  attribution: "Editorial statement, MindeesAI 0.2.0",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy helpers — preserved for any older consumers (e.g. /lib/psychology/trust)
// ─────────────────────────────────────────────────────────────────────────────

export const headlines = {
  hero: "An AI that gets smarter every five minutes — and remembers you forever.",
  heroSub:
    "MindeesAI is open-source, self-improving, and runs on your laptop. No subscription. No surveillance. No forgetting.",
  trustBar: "Free. Open-source. MIT-licensed. Self-hostable. Yours.",
} as const;

export const lossAversion = {
  forgetting:
    "Most AIs forget you the moment your tab closes. MindeesAI remembers — and gets a little smarter every five minutes you keep using it.",
  vendorLock:
    "Closed AIs own your context. The day they raise prices, you have no choice. MindeesAI runs on your laptop, your server, your terms.",
} as const;

export const authority = {
  citationsAreFirstClass:
    "Every factual answer carries citations. Hover any [1] to see the source. No citation? Then it's our inference — and we say so.",
  reflectionLog:
    "The 5-minute self-improvement loop writes an append-only log. You can audit every change MindeesAI has made to its own brain.",
} as const;

export const reciprocity = {
  freeTier:
    "There is no paid tier. The free version is the full version.",
} as const;

export const specificity = {
  ttfb: "Streaming starts in under 200ms on a warm Ollama instance.",
  retrieval: "Recall is augmented by a LanceDB vector store with sub-50ms top-K retrieval.",
  cadence: "Self-improvement runs every 5 minutes — that's 288 brain updates per day.",
} as const;
