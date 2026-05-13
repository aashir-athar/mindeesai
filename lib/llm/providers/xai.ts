/**
 * xAI (Grok) provider — OpenAI-compatible Chat Completions.
 * Activated when XAI_API_KEY is set.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk } from "@/lib/types";
import { streamOpenAICompatible } from "./openai";

export const xaiProvider: LLMProvider = {
  id: "xai",
  isAvailable() {
    return Boolean(env.XAI_API_KEY);
  },
  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    yield* streamOpenAICompatible(req, {
      baseUrl: "https://api.x.ai/v1",
      apiKey: env.XAI_API_KEY ?? "",
      label: "xai",
      defaultModel: "grok-3",
    });
  },
};
