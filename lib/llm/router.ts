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
import { ollamaProvider } from "./providers/ollama";
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

  // (2) Ollama if reachable
  if (PROVIDERS.ollama.isAvailable()) {
    return { provider: PROVIDERS.ollama, modelId: bareModelId(req.modelId) ?? env.DEFAULT_CHAT_MODEL };
  }

  // (3) first available cloud provider
  for (const pid of CLOUD_PREFERENCE) {
    if (PROVIDERS[pid].isAvailable()) {
      log.warn(`Ollama unreachable — falling back to ${pid}`);
      return { provider: PROVIDERS[pid], modelId: bareModelId(req.modelId) ?? defaultCloudModel(pid) };
    }
  }

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

/** Single entrypoint used by the orchestrator. */
export async function* streamLLM(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
  const { provider, modelId } = await pickProvider(req);
  log.debug(`stream → ${provider.id}/${modelId}`);
  for await (const chunk of provider.stream({ ...req, modelId })) {
    yield chunk;
  }
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
