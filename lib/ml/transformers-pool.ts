/**
 * Centralised transformers.js pipeline cache.
 *
 * Every place that loads a transformers.js model goes through here so:
 *   - models are lazy-loaded on first use (no cold-start tax until needed)
 *   - the same model is never loaded twice on the same function instance
 *   - graceful fallback: if a download fails the caller gets null, not a throw
 *
 * Memory budget on Vercel Hobby (~1024 MB total function memory):
 *
 *   Always loaded if used:
 *     emotion classifier             ~80 MB  (Q8)
 *     BGE embedder                   ~40 MB  (Q8)
 *
 *   Added in earlier batch:
 *     ms-marco reranker              ~30 MB  (Q8)
 *     twitter-roberta sentiment      ~60 MB  (Q8)
 *     bert-base-NER                 ~110 MB  (Q8)
 *     toxic-bert                    ~110 MB  (Q8)
 *
 *   Added in this batch (Tier 1 — safety + routing + summarisation):
 *     PII detector (deberta-base)    ~75 MB  (Q8)
 *     zero-shot NLI (deberta-xsmall) ~50 MB  (Q8)
 *     summariser (distilbart-cnn-6-6)~150 MB (Q8)
 *
 *   Subtotal worst case:           ~705 MB  (all loaded simultaneously)
 *   Plus baseline runtime:         ~400 MB
 *   Headroom under Hobby limit:    -80 MB (TIGHT — but models are lazy-loaded
 *                                          and rarely all live at once. The
 *                                          PII + summariser paths fire on
 *                                          different timescales.)
 *
 * Every model is loaded with `dtype: "q8"` for the smallest viable footprint.
 * First-call latency: ~5-15s per model on cold function. Steady-state: ~10-100ms.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("transformers-pool");

type AnyPipeline = (...args: unknown[]) => Promise<unknown>;

interface ModelSpec {
  /** transformers.js pipeline task — one of: "text-classification",
   *  "token-classification", "feature-extraction", "fill-mask", "summarization",
   *  "question-answering", "zero-shot-classification", etc. */
  task: string;
  model: string;
  /** Quantization. "q8" is the safe small default. */
  dtype?: "q4" | "q8" | "fp16" | "fp32";
}

const cache = new Map<string, Promise<AnyPipeline | null>>();

/**
 * Get a lazily-loaded transformers.js pipeline, cached for the lifetime of
 * the function instance. Returns null on any load failure — caller should
 * fall back to rule-based behaviour.
 */
export async function getPipeline(spec: ModelSpec): Promise<AnyPipeline | null> {
  const key = `${spec.task}::${spec.model}::${spec.dtype ?? "q8"}`;
  if (cache.has(key)) return cache.get(key)!;
  const p = (async (): Promise<AnyPipeline | null> => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      log.info(`loading ${spec.task} model ${spec.model} (${spec.dtype ?? "q8"})...`);
      const t0 = performance.now();
      const pl = (await pipeline(spec.task as never, spec.model, {
        dtype: spec.dtype ?? "q8",
      })) as unknown as AnyPipeline;
      log.info(`  loaded ${spec.model} in ${(performance.now() - t0).toFixed(0)}ms`);
      return pl;
    } catch (e) {
      log.warn(`could not load ${spec.model} — falling back to rule-based`, e);
      return null;
    }
  })();
  cache.set(key, p);
  return p;
}

// ─── Named specs for the four models we use ──────────────────────────────

export const MODELS = {
  /** Cross-encoder reranker for retrieved memories / web hits. */
  reranker: {
    task: "text-classification",
    model: "Xenova/ms-marco-MiniLM-L-12-v2",
    dtype: "q8" as const,
  },
  /** 3-class sentiment (negative / neutral / positive) trained on Twitter —
   *  handles sarcasm + ironic register better than the broader emotion model. */
  sentiment: {
    task: "text-classification",
    model: "Xenova/twitter-roberta-base-sentiment-latest",
    dtype: "q8" as const,
  },
  /** Named-entity recognition (PER / LOC / ORG / MISC). */
  ner: {
    task: "token-classification",
    model: "Xenova/bert-base-NER",
    dtype: "q8" as const,
  },
  /** Toxicity classifier (toxic / severe_toxic / obscene / threat / insult / identity_hate). */
  toxicity: {
    task: "text-classification",
    model: "Xenova/toxic-bert",
    dtype: "q8" as const,
  },
  /** PII / personal-info token classifier. Tags spans like EMAIL, PHONE,
   *  CREDITCARD, ADDRESS, SOCIALNUM, etc. Used to redact distill-corpus
   *  rows BEFORE they hit a public HF repo or get pushed to R2. */
  pii: {
    task: "token-classification",
    model: "Xenova/piiranha-v1-detect-personal-information",
    dtype: "q8" as const,
  },
  /** Zero-shot text classifier — supply any candidate labels at call time.
   *  Used by the orchestrator to route messages by topic ("code", "math",
   *  "personal", "creative", "factual") and pick the right system prompt
   *  + connector subset without training a separate classifier per axis. */
  zeroShot: {
    task: "zero-shot-classification",
    model: "Xenova/nli-deberta-v3-xsmall",
    dtype: "q8" as const,
  },
  /** Abstractive summariser (DistilBART trained on CNN/DM). Replaces the
   *  LLM call in lib/threads/summary.ts so long-thread rolling summaries
   *  are free of cloud quota cost. ~150 MB Q8; only loaded when a thread
   *  actually crosses the summarisation interval. */
  summarizer: {
    task: "summarization",
    model: "Xenova/distilbart-cnn-6-6",
    dtype: "q8" as const,
  },
} satisfies Record<string, ModelSpec>;

/** Convenience helpers — each returns null on failure, never throws. */
export async function rerankerPipeline() {
  return getPipeline(MODELS.reranker);
}
export async function sentimentPipeline() {
  return getPipeline(MODELS.sentiment);
}
export async function nerPipeline() {
  return getPipeline(MODELS.ner);
}
export async function toxicityPipeline() {
  return getPipeline(MODELS.toxicity);
}
export async function piiPipeline() {
  return getPipeline(MODELS.pii);
}
export async function zeroShotPipeline() {
  return getPipeline(MODELS.zeroShot);
}
export async function summarizerPipeline() {
  return getPipeline(MODELS.summarizer);
}
