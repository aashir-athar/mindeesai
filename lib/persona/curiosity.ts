/**
 * Curiosity-gap detector.
 *
 * "How novel is this question relative to what Mindees already knows about
 * this user/topic?" Computed as 1 − max(cosine similarity) between the
 * incoming message embedding and the top-K existing memory embeddings.
 *
 * High novelty → boost the curiosity dim of the mood tensor.
 * Low novelty (déjà vu) → bias toward calmer, more confident phrasing.
 *
 * Cost: one embedding call per turn (~50ms with Ollama nomic-embed-text,
 * or ~120ms with the transformers.js BGE fallback).
 */

import type { RetrievalHit } from "@/lib/types";

export interface CuriosityGap {
  /** 0 = completely seen before, 1 = totally new. */
  novelty: number;
  /** Best cosine match found — useful for "you mentioned X earlier" callbacks. */
  closestMemory?: { text: string; score: number };
}

/**
 * Pure function — caller provides the already-retrieved memory hits and we
 * convert into a novelty score from their similarity scores.
 *
 * The retriever already used the same query embedding, so `hit.score` is
 * effectively the cosine similarity in [0..1] for the same vector space.
 */
export function curiosityGap(hits: RetrievalHit[]): CuriosityGap {
  if (hits.length === 0) return { novelty: 1 };
  const best = hits.reduce((m, h) => (h.score > m.score ? h : m), hits[0]!);
  const novelty = Math.max(0, 1 - best.score);
  return {
    novelty,
    closestMemory: novelty < 0.4 ? { text: best.text, score: best.score } : undefined,
  };
}

/** A short note for the system prompt when there's strong déjà-vu. */
export function curiosityNarrative(gap: CuriosityGap): string {
  if (gap.novelty > 0.7) return "This question is new ground for you — bring genuine curiosity.";
  if (gap.novelty < 0.3 && gap.closestMemory) {
    return `You've discussed something close to this before. Reference it explicitly if useful: "${truncate(gap.closestMemory.text, 100)}".`;
  }
  return "";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
