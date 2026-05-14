/**
 * Reranking — re-order retrieved hits by relevance to the query.
 *
 * Two-tier strategy:
 *   1. PRIMARY: ms-marco-MiniLM-L-12-v2 cross-encoder via transformers.js
 *      (run query+document through a single model, returns a relevance
 *      score; much higher precision than bi-encoder cosine).
 *   2. FALLBACK: cosine similarity using the existing embedder if the
 *      cross-encoder isn't available (cold-fetch failure, etc).
 *
 * Cross-encoder cost: ~30 MB model, ~50-100ms per pair on CPU. With
 * default 8 hits per recall, that's <1s per memory-pull turn — worth
 * it for the precision gain.
 */

import { embed, cosine } from "@/lib/embeddings";
import { rerankerPipeline } from "@/lib/ml/transformers-pool";
import type { ResearchHit } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("rerank");

interface ScoredOutput { label?: string; score: number }

export async function rerank<T extends { snippet?: string; title: string }>(
  query: string,
  hits: T[],
  k = hits.length,
): Promise<Array<T & { rerankScore: number }>> {
  if (hits.length === 0) return [];

  const xenc = await rerankerPipeline();
  if (xenc) {
    try {
      const scored = await Promise.all(
        hits.map(async (h) => {
          const doc = `${h.title}\n${h.snippet ?? ""}`.slice(0, 2000);
          const out = (await xenc({ text: query, text_pair: doc })) as unknown;
          const result = Array.isArray(out) ? out[0] : out;
          const score = typeof (result as ScoredOutput)?.score === "number"
            ? (result as ScoredOutput).score
            : 0;
          return { ...h, rerankScore: score };
        }),
      );
      scored.sort((a, b) => b.rerankScore - a.rerankScore);
      return scored.slice(0, k);
    } catch (e) {
      log.warn("cross-encoder rerank failed mid-call, falling back to cosine", e);
    }
  }

  // Fallback: bi-encoder cosine similarity (the previous behaviour)
  const qVec = await embed(query);
  const scored = await Promise.all(
    hits.map(async (h) => {
      const text = `${h.title}\n${h.snippet ?? ""}`.slice(0, 2000);
      const vec = await embed(text);
      return { ...h, rerankScore: cosine(qVec, vec) };
    }),
  );
  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  return scored.slice(0, k);
}

export type RerankedHit = ResearchHit & { rerankScore: number };
