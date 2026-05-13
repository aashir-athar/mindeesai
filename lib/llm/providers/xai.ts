/**
 * xAI (Grok) provider — OpenAI-compatible Chat Completions.
 * Activated only when XAI_API_KEY is set.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk } from "@/lib/types";
import { openaiProvider } from "./openai";

export const xaiProvider: LLMProvider = {
  id: "xai",
  isAvailable() {
    return Boolean(env.XAI_API_KEY);
  },
  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    if (!env.XAI_API_KEY) {
      yield { type: "text", text: "[xai: no API key configured]" };
      yield { type: "finish" };
      return;
    }
    // Reuse the OpenAI SSE parser but swap the URL + key.
    const original = global.fetch;
    const patched: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("api.openai.com")) {
        const next = url.replace("https://api.openai.com", "https://api.x.ai");
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${env.XAI_API_KEY}`);
        return original(next, { ...init, headers });
      }
      return original(input as RequestInfo, init);
    };
    global.fetch = patched;
    try {
      for await (const chunk of openaiProvider.stream({ ...req, modelId: req.modelId ?? "grok-3" })) {
        yield chunk;
      }
    } finally {
      global.fetch = original;
    }
  },
};
