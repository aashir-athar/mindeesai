/**
 * Groq provider — OpenAI-compatible Chat Completions, very fast.
 * Activated when GROQ_API_KEY is set.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk } from "@/lib/types";
import { streamOpenAICompatible } from "./openai";

export const groqProvider: LLMProvider = {
  id: "groq",
  isAvailable() {
    return Boolean(env.GROQ_API_KEY);
  },
  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    yield* streamOpenAICompatible(req, {
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: env.GROQ_API_KEY ?? "",
      label: "groq",
      defaultModel: "llama-3.3-70b-versatile",
    });
  },
};
