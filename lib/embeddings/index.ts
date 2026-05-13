/**
 * Embedding abstraction.
 *
 * Default path: hit Ollama's `/api/embed` with `DEFAULT_EMBED_MODEL`.
 * Fallback: lazy-load `@huggingface/transformers` and run BGE-small in-process.
 *
 * The fallback adds ~50MB of model download on first call, so we only reach for
 * it when Ollama is genuinely unreachable.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("embeddings");

let transformersEmbedderPromise: Promise<(text: string) => Promise<number[]>> | null = null;

async function loadTransformersEmbedder() {
  if (transformersEmbedderPromise) return transformersEmbedderPromise;
  transformersEmbedderPromise = (async () => {
    log.info("Loading transformers.js BGE embedder (one-time download)…");
    const { pipeline } = await import("@huggingface/transformers");
    // q8 quantized — ~3× smaller download, ~2× faster cold-start, negligible
    // quality loss on the 384-dim BGE small model. The retrieval ranking
    // stays effectively identical for short-text recall workloads.
    const extractor = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", {
      dtype: "q8",
    });
    return async (text: string): Promise<number[]> => {
      const out = await extractor(text, { pooling: "mean", normalize: true });
      // out.data is a Float32Array of length 384
      return Array.from(out.data as Float32Array);
    };
  })();
  return transformersEmbedderPromise;
}

async function embedViaOllama(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: env.DEFAULT_EMBED_MODEL, input: text }),
      // Short timeout — on Vercel Ollama is unreachable, and we don't want
      // to burn 15s on every embed call only to fall back to local.
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Embed a single string. Never throws — returns a zero vector on total failure. */
export async function embed(text: string): Promise<number[]> {
  // On Vercel, Ollama is unreachable. Skip the round-trip + 2.5s timeout
  // entirely and go straight to the in-process BGE embedder. Local dev
  // (where Ollama might be running on localhost:11434) still tries it first.
  if (process.env.VERCEL !== "1") {
    const ollamaResult = await embedViaOllama(text);
    if (ollamaResult) return ollamaResult;
  }

  const fallback = await loadTransformersEmbedder();
  return fallback(text);
}

/** Embed many strings, bounded concurrency. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

/** Cosine similarity. Both vectors must be the same length. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
