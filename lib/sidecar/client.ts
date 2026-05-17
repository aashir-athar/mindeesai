/**
 * Typed HTTP client for the MindeesAI sidecar.
 *
 * The sidecar (scripts/sidecar/) hosts LanceDB + transformers.js — anything
 * that requires native .node binaries which the Cloudflare Workers V8
 * isolates runtime cannot load. The main app calls it over HTTPS+Bearer.
 *
 * Every call returns a typed response on success. On any failure — network
 * error, 4xx, 5xx, missing config — returns null. Callers MUST handle null
 * with a graceful fallback (regex, heuristic, or skip entirely). This is
 * deliberate: we never want a sidecar hiccup to crash a chat turn.
 *
 * When SIDECAR_URL is unset, every call short-circuits to null. The main
 * app's legacy in-process code paths (under their `isAvailable()` guards)
 * become the only execution path — useful for local dev and the Oracle/HF
 * Spaces direct deploys that don't need a sidecar.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type {
  EmbedRequest,
  EmbedResponse,
  MemoryRecallRequest,
  MemoryRecallResponse,
  MemoryRememberRequest,
  MemoryRememberResponse,
  PiiRequest,
  PiiResponse,
  ClassifyRequest,
  ClassifyResponse,
  RerankRequest,
  RerankResponse,
  SummarizeRequest,
  SummarizeResponse,
} from "./types";

const log = createLogger("sidecar");

/** True iff sidecar is configured. Use to short-circuit fallbacks early. */
export function isSidecarConfigured(): boolean {
  return Boolean(env.SIDECAR_URL && env.SIDECAR_AUTH_TOKEN);
}

interface CallOptions {
  /** Per-call timeout in ms. Defaults vary by endpoint. */
  timeoutMs?: number;
}

async function call<TReq, TRes>(path: string, body: TReq, opts: CallOptions = {}): Promise<TRes | null> {
  if (!env.SIDECAR_URL || !env.SIDECAR_AUTH_TOKEN) {
    return null;
  }
  const url = env.SIDECAR_URL.replace(/\/+$/, "") + path;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.SIDECAR_AUTH_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      log.warn(`${path} → HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as TRes;
  } catch (e) {
    log.warn(`${path} → ${(e as Error).message}`);
    return null;
  }
}

// ─── Embeddings ─────────────────────────────────────────────────────────

export async function sidecarEmbed(text: string, opts: CallOptions = {}): Promise<number[] | null> {
  const out = await call<EmbedRequest, EmbedResponse>("/embed", { text }, { timeoutMs: 5_000, ...opts });
  return out?.vector ?? null;
}

// ─── Memory ────────────────────────────────────────────────────────────

export async function sidecarRecall(
  args: MemoryRecallRequest,
  opts: CallOptions = {},
): Promise<MemoryRecallResponse["hits"] | null> {
  const out = await call<MemoryRecallRequest, MemoryRecallResponse>("/memory/recall", args, { timeoutMs: 8_000, ...opts });
  return out?.hits ?? null;
}

export async function sidecarRecallInsights(
  args: Pick<MemoryRecallRequest, "query" | "k">,
  opts: CallOptions = {},
): Promise<MemoryRecallResponse["hits"] | null> {
  const out = await call<MemoryRecallRequest, MemoryRecallResponse>(
    "/memory/recall-insights",
    args,
    { timeoutMs: 8_000, ...opts },
  );
  return out?.hits ?? null;
}

export async function sidecarRemember(args: MemoryRememberRequest, opts: CallOptions = {}): Promise<number | null> {
  const out = await call<MemoryRememberRequest, MemoryRememberResponse>("/memory/remember", args, { timeoutMs: 15_000, ...opts });
  return out?.inserted ?? null;
}

export async function sidecarPromoteInsights(args: MemoryRememberRequest, opts: CallOptions = {}): Promise<number | null> {
  const out = await call<MemoryRememberRequest, MemoryRememberResponse>("/memory/promote", args, { timeoutMs: 15_000, ...opts });
  return out?.inserted ?? null;
}

// ─── PII ───────────────────────────────────────────────────────────────

export async function sidecarPii(text: string, opts: CallOptions = {}): Promise<PiiResponse | null> {
  return call<PiiRequest, PiiResponse>("/pii", { text }, { timeoutMs: 5_000, ...opts });
}

// ─── Classify ──────────────────────────────────────────────────────────

export async function sidecarClassify(args: ClassifyRequest, opts: CallOptions = {}): Promise<ClassifyResponse | null> {
  return call<ClassifyRequest, ClassifyResponse>("/classify", args, { timeoutMs: 6_000, ...opts });
}

// ─── Rerank ────────────────────────────────────────────────────────────

export async function sidecarRerank(args: RerankRequest, opts: CallOptions = {}): Promise<RerankResponse | null> {
  return call<RerankRequest, RerankResponse>("/rerank", args, { timeoutMs: 15_000, ...opts });
}

// ─── Summarize ─────────────────────────────────────────────────────────

export async function sidecarSummarize(args: SummarizeRequest, opts: CallOptions = {}): Promise<string | null> {
  const out = await call<SummarizeRequest, SummarizeResponse>("/summarize", args, { timeoutMs: 20_000, ...opts });
  return out?.summary ?? null;
}
