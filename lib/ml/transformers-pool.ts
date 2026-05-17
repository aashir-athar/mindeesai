/**
 * transformers.js pipeline shims — back the legacy pipeline interface with
 * sidecar HTTP calls.
 *
 * Pipeline runtime moved entirely into the sidecar (scripts/sidecar/) so
 * the main app's Cloudflare Workers deploy doesn't need to bundle the
 * native onnxruntime-node binaries.
 *
 * Each `xxxPipeline()` returns either:
 *   - A closure shaped like the original transformers.js pipeline output,
 *     which internally fetches the sidecar — callers don't change.
 *   - `null` when the sidecar isn't configured, forcing every caller's
 *     existing "fall back to rule-based" branch.
 *
 * Reshaping happens here once so 14 call sites stay verbatim.
 */

import { createLogger } from "@/lib/logger";
import { isSidecarConfigured, sidecarClassify, sidecarSummarize, sidecarRerank } from "@/lib/sidecar/client";

const log = createLogger("transformers-pool");

type AnyPipeline = (...args: unknown[]) => Promise<unknown>;

// ─── PII (token-classification) ─────────────────────────────────────────

export async function piiPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    // pii-guard.ts has a fast-path: post directly to /pii (returns redacted
    // text + spans). But the pipeline contract used by older callers
    // expects token-classification output. Wrap /pii so legacy shape works.
    // We re-route through /classify with task=ner to get token-class output.
    // Note: NER tags differ from PII tags — pii-guard.ts switched to using
    // sidecarPii() directly so this path is mainly for completeness.
    const out = await sidecarClassify({ task: "ner", text });
    return (out?.entities ?? []).map((e) => ({
      entity: e.entity,
      entity_group: e.entity,
      word: e.word,
      start: e.start,
      end: e.end,
      score: e.score,
    }));
  }) as AnyPipeline;
}

// ─── NER (token-classification) ─────────────────────────────────────────

export async function nerPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    const out = await sidecarClassify({ task: "ner", text });
    return (out?.entities ?? []).map((e) => ({
      entity_group: e.entity,
      entity: e.entity,
      word: e.word,
      start: e.start,
      end: e.end,
      score: e.score,
    }));
  }) as AnyPipeline;
}

// ─── Sentiment (text-classification) ────────────────────────────────────

export async function sentimentPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    const out = await sidecarClassify({ task: "sentiment", text });
    return out?.labels ?? [];
  }) as AnyPipeline;
}

// ─── Toxicity (text-classification) ─────────────────────────────────────

export async function toxicityPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    const out = await sidecarClassify({ task: "toxicity", text });
    return out?.labels ?? [];
  }) as AnyPipeline;
}

// ─── Zero-shot classification ───────────────────────────────────────────

export async function zeroShotPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    const labels = Array.isArray(args[1]) ? (args[1] as string[]) : [];
    const out = await sidecarClassify({ task: "zero-shot", text, labels });
    const ls = out?.labels ?? [];
    return {
      sequence: text,
      labels: ls.map((x) => x.label),
      scores: ls.map((x) => x.score),
    };
  }) as AnyPipeline;
}

// ─── Summarizer ─────────────────────────────────────────────────────────

export async function summarizerPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    const opts = (args[1] ?? {}) as { max_length?: number; min_length?: number };
    const summary = await sidecarSummarize({
      text,
      maxLength: opts.max_length,
      minLength: opts.min_length,
    });
    return summary ? [{ summary_text: summary }] : [];
  }) as AnyPipeline;
}

// ─── Reranker (cross-encoder text-classification) ───────────────────────

export async function rerankerPipeline(): Promise<AnyPipeline | null> {
  if (!isSidecarConfigured()) return null;
  return (async (...args: unknown[]) => {
    // Legacy contract: pl({text, text_pair}) returns [{label, score}].
    // The sidecar /rerank endpoint is batch-oriented; for a single pair we
    // emulate the old single-pair contract by sending one document.
    const pair = args[0] as { text?: string; text_pair?: string };
    if (!pair?.text || !pair.text_pair) return [{ label: "NEG", score: 0 }];
    const out = await sidecarRerank({ query: pair.text, documents: [pair.text_pair] });
    const score = out?.results?.[0]?.score ?? 0;
    return [{ label: "POS", score }];
  }) as AnyPipeline;
}

// ─── Compat exports (unused now, kept for type compat in case any tooling
// still references MODELS). Each spec points at the model the SIDECAR
// loads — the main app no longer loads any of these locally.

export const MODELS = {
  reranker: { model: "Xenova/ms-marco-MiniLM-L-12-v2" },
  sentiment: { model: "Xenova/twitter-roberta-base-sentiment-latest" },
  ner: { model: "Xenova/bert-base-NER" },
  toxicity: { model: "Xenova/toxic-bert" },
  pii: { model: "Xenova/piiranha-v1-detect-personal-information" },
  zeroShot: { model: "Xenova/nli-deberta-v3-xsmall" },
  summarizer: { model: "Xenova/distilbart-cnn-6-6" },
} as const;

// Suppress unused-import warning while we keep the logger ready for future
// telemetry on sidecar call failures.
void log;
