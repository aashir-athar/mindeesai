/**
 * Lightweight reranking — re-orders hits by cosine similarity against the
 * original query, using whichever embedder is available.
 *
 * This is *not* a real cross-encoder. A future improvement is to call an
 * ONNX BGE-reranker via @huggingface/transformers — wired as a TODO.
 */

import { embed, cosine } from "@/lib/embeddings";
import type { ResearchHit } from "@/lib/types";

export async function rerank<T extends { snippet?: string; title: string }>(
  query: string,
  hits: T[],
  k = hits.length,
): Promise<Array<T & { rerankScore: number }>> {
  if (hits.length === 0) return [];
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
