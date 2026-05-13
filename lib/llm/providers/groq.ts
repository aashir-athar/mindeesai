/**
 * Groq provider — OpenAI-compatible, blazing fast.
 * Activated only when GROQ_API_KEY is set.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk } from "@/lib/types";
import { openaiProvider } from "./openai";

export const groqProvider: LLMProvider = {
  id: "groq",
  isAvailable() {
    return Boolean(env.GROQ_API_KEY);
  },
  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    if (!env.GROQ_API_KEY) {
      yield { type: "text", text: "[groq: no API key configured]" };
      yield { type: "finish" };
      return;
    }
    const original = global.fetch;
    const patched: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("api.openai.com")) {
        const next = url.replace("https://api.openai.com", "https://api.groq.com/openai");
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${env.GROQ_API_KEY}`);
        return original(next, { ...init, headers });
      }
      return original(input as RequestInfo, init);
    };
    global.fetch = patched;
    try {
      for await (const chunk of openaiProvider.stream({
        ...req,
        modelId: req.modelId ?? "llama-3.3-70b-versatile",
      })) {
        yield chunk;
      }
    } finally {
      global.fetch = original;
    }
  },
};
