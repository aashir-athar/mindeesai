/**
 * LLM Router — picks the right provider for a request and falls back gracefully.
 *
 * Routing priority (highest first):
 *   1. Explicit `modelId` — model prefix maps to a provider:
 *        "anthropic:..." → Anthropic
 *        "openai:..."    → OpenAI
 *        "xai:..."       → xAI
 *        "groq:..."      → Groq
 *        "google:..."    → Google
 *        everything else → Ollama (default, local-first)
 *   2. Implicit Ollama if reachable
 *   3. First configured cloud provider, in this order:
 *        Anthropic → xAI → OpenAI → Groq → Google
 *
 * The router never throws on missing providers. If no provider is available,
 * `stream()` yields a single text chunk explaining how to fix the configuration
 * — better UX than crashing the chat.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk, ProviderId } from "@/lib/types";
import { ollamaProvider, probeOllama } from "./providers/ollama";
import { anthropicProvider } from "./providers/anthropic";
import { openaiProvider } from "./providers/openai";
import { xaiProvider } from "./providers/xai";
import { groqProvider } from "./providers/groq";
import { googleProvider } from "./providers/google";
import { createLogger } from "@/lib/logger";

const log = createLogger("llm-router");

const PROVIDERS: Record<ProviderId, LLMProvider> = {
  ollama: ollamaProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  xai: xaiProvider,
  groq: groqProvider,
  google: googleProvider,
};

const CLOUD_PREFERENCE: ProviderId[] = ["anthropic", "xai", "openai", "groq", "google"];

/** Inspect the modelId to detect an explicit provider prefix. */
function providerFromModelId(modelId?: string): ProviderId | null {
  if (!modelId) return null;
  const m = modelId.match(/^(anthropic|openai|xai|groq|google|ollama):/);
  return (m?.[1] as ProviderId) ?? null;
}

/** Strip the provider prefix from a modelId. */
function bareModelId(modelId?: string): string | undefined {
  if (!modelId) return undefined;
  const idx = modelId.indexOf(":");
  if (idx > -1 && idx < 10) return modelId.slice(idx + 1);
  return modelId;
}

export async function pickProvider(req: LLMRequest): Promise<{ provider: LLMProvider; modelId: string }> {
  // (1) explicit
  const explicit = providerFromModelId(req.modelId);
  if (explicit && PROVIDERS[explicit].isAvailable()) {
    return { provider: PROVIDERS[explicit], modelId: bareModelId(req.modelId) ?? env.DEFAULT_CHAT_MODEL };
  }

  // (2) prefer cloud providers when they're configured — they're faster, more
  //     reliable, and don't require a local install. Only fall back to Ollama
  //     when no cloud key is present.
  for (const pid of CLOUD_PREFERENCE) {
    if (PROVIDERS[pid].isAvailable()) {
      return { provider: PROVIDERS[pid], modelId: bareModelId(req.modelId) ?? defaultCloudModel(pid) };
    }
  }

  // (3) Ollama if reachable — actually await the probe so we don't hang the chat
  //     waiting on an unreachable local instance.
  const ollamaUp = await probeOllama();
  if (ollamaUp) {
    return { provider: PROVIDERS.ollama, modelId: bareModelId(req.modelId) ?? env.DEFAULT_CHAT_MODEL };
  }
  log.warn("no cloud provider configured and Ollama unreachable");

  // none — return a "stub" provider with a friendly message
  return { provider: noProviderStub, modelId: "stub" };
}

function defaultCloudModel(pid: ProviderId): string {
  switch (pid) {
    case "anthropic": return "claude-opus-4-7";
    case "xai":       return "grok-3";
    case "openai":    return "gpt-5";
    case "groq":      return "llama-3.3-70b-versatile";
    case "google":    return "gemini-2.5-pro";
    default:          return env.DEFAULT_CHAT_MODEL;
  }
}

/**
 * Free-tier fallback chain.
 *
 * Each entry is tried in order. On 429 (rate limit) or transient 5xx the
 * router immediately moves to the next entry. Each Groq model has its
 * OWN per-day token quota, so we get effective ~4× the daily budget by
 * cycling between them. Google Gemini Flash has a generous separate
 * free tier (15 RPM / 1500 RPD) and uses no Groq quota.
 *
 * Order matters: highest-quality model first when its quota is healthy,
 * smaller / different-quota models as fallbacks. Last resort is the
 * Mindees graceful-degradation message so the chat never crashes raw.
 */
type FallbackEntry = { provider: ProviderId; model: string };
const FREE_FALLBACK_CHAIN: FallbackEntry[] = [
  { provider: "groq",   model: "llama-3.3-70b-versatile" },      // primary
  { provider: "groq",   model: "llama-3.1-8b-instant" },         // separate Groq quota
  { provider: "groq",   model: "openai/gpt-oss-120b" },          // separate Groq quota
  { provider: "groq",   model: "openai/gpt-oss-20b" },           // separate Groq quota
  { provider: "groq",   model: "gemma2-9b-it" },                 // separate Groq quota
  { provider: "google", model: "gemini-2.5-flash" },             // free tier 15 RPM / 1500 RPD
  { provider: "google", model: "gemini-2.0-flash" },             // older free model
];

/** Build the routing chain for THIS request. */
function buildAttempts(req: LLMRequest): FallbackEntry[] {
  const explicit = providerFromModelId(req.modelId);
  if (explicit) {
    // User pinned a specific provider — try it first, then fall through to chain
    const bare = bareModelId(req.modelId)!;
    return [{ provider: explicit, model: bare }, ...FREE_FALLBACK_CHAIN.filter((f) => f.provider !== explicit || f.model !== bare)];
  }
  return FREE_FALLBACK_CHAIN.filter((f) => PROVIDERS[f.provider].isAvailable());
}

/** Recognise errors that mean "try the next provider/model". */
function shouldFailover(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { isRateLimit?: boolean; status?: number; message?: string };
  if (err.isRateLimit) return true;
  if (err.status === 429) return true;
  if (err.status && err.status >= 500 && err.status < 600) return true; // server errors
  const msg = String(err.message || "");
  return /rate.?limit|too many requests|quota|tokens per day|TPD/i.test(msg);
}

/** Single entrypoint used by the orchestrator. */
export async function* streamLLM(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
  const attempts = buildAttempts(req);

  // If chain is empty (no cloud key, no Ollama), use the original pickProvider
  // path which surfaces the friendly "no provider configured" message.
  if (attempts.length === 0) {
    const { provider, modelId } = await pickProvider(req);
    for await (const chunk of provider.stream({ ...req, modelId })) yield chunk;
    return;
  }

  let lastError: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const { provider: pid, model } = attempts[i]!;
    const provider = PROVIDERS[pid];
    if (!provider.isAvailable()) continue;
    log.info(`stream attempt ${i + 1}/${attempts.length} → ${pid}/${model}`);

    let yieldedAny = false;
    try {
      for await (const chunk of provider.stream({ ...req, modelId: model })) {
        yieldedAny = true;
        yield chunk;
      }
      return; // success — chain complete
    } catch (e) {
      lastError = e;
      const failover = shouldFailover(e);
      log.warn(`${pid}/${model} failed${yieldedAny ? " mid-stream" : ""}${failover ? " (rate-limited, trying next)" : ""}`, e);
      if (yieldedAny || !failover) {
        // Either we already committed text to the user OR it's not a failover-worthy
        // error. Either way, surface a graceful end and stop.
        if (!yieldedAny) {
          yield {
            type: "text",
            text: "Something's off on the model side right now — give me a moment and try again.",
          };
        }
        yield { type: "finish" };
        return;
      }
      // Otherwise loop to the next attempt.
    }
  }

  // Exhausted the chain. Yield a Mindees-voice graceful message.
  log.error("all fallback providers exhausted", lastError);
  yield {
    type: "text",
    text:
      "I'm hitting rate limits on every backend I have right now. " +
      "The daily token quotas reset on a rolling 24h window — try again in a bit, " +
      "or flip USE_NATIVE_MODEL on /admin if there's a checkpoint loaded.",
  };
  yield { type: "finish" };
}

const noProviderStub: LLMProvider = {
  id: "ollama",
  isAvailable: () => true,
  async *stream() {
    yield {
      type: "text",
      text:
        "MindeesAI has no LLM provider configured. " +
        "Either start Ollama locally (https://ollama.com) and pull a model, or " +
        "set one of ANTHROPIC_API_KEY / XAI_API_KEY / OPENAI_API_KEY / GROQ_API_KEY in .env.local.",
    };
    yield { type: "finish" };
  },
};
