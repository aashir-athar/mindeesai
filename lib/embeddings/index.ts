/**
 * Embedding abstraction.
 *
 * Priority order:
 *   1. Sidecar (`SIDECAR_URL`) — production path. Runs BGE-small on HF Spaces.
 *   2. Ollama at `OLLAMA_BASE_URL` — local-dev path for users running Ollama.
 *   3. Zero vector — last-resort fallback so callers never throw.
 *
 * The legacy in-process transformers.js path is gone: BGE-small now lives
 * exclusively in the sidecar so Cloudflare Workers can deploy without native
 * binaries. For local dev without a sidecar, run `npm --prefix
 * scripts/sidecar start` in a side terminal and set `SIDECAR_URL=http://localhost:7860`.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { sidecarEmbed, isSidecarConfigured } from "@/lib/sidecar/client";

const log = createLogger("embeddings");

const EMBED_DIM = 384;

let warnedNoBackend = false;
function warnNoBackend() {
  if (warnedNoBackend) return;
  warnedNoBackend = true;
  log.warn(
    "no embedding backend reachable (sidecar unset, Ollama unreachable) — returning zero vectors. " +
    "Set SIDECAR_URL or start a local sidecar.",
  );
}

async function embedViaOllama(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: env.DEFAULT_EMBED_MODEL, input: text }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Embed a single string. Never throws. Returns zero vector on total failure. */
export async function embed(text: string): Promise<number[]> {
  if (isSidecarConfigured()) {
    const out = await sidecarEmbed(text);
    if (out) return out;
  }

  // Local dev fallback: Ollama on localhost. Skip on Cloudflare Workers
  // since fetch to localhost won't reach anything anyway.
  if (process.env.VERCEL !== "1" && process.env.CF_PAGES !== "1") {
    const ollamaResult = await embedViaOllama(text);
    if (ollamaResult) return ollamaResult;
  }

  warnNoBackend();
  return new Array(EMBED_DIM).fill(0);
}

/** Embed many strings sequentially (preserves order). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

/** Cosine similarity. */
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
