/**
 * Google Gemini provider — minimal streaming over the v1beta REST endpoint.
 * Activated when GOOGLE_GENERATIVE_AI_API_KEY is set.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk, Message } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("google");

function toGemini(messages: Message[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export const googleProvider: LLMProvider = {
  id: "google",
  isAvailable() {
    return Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);
  },
  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
      yield { type: "text", text: "[google: no API key configured]" };
      yield { type: "finish" };
      return;
    }
    const model = req.modelId ?? "gemini-2.5-pro";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${env.GOOGLE_GENERATIVE_AI_API_KEY}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: toGemini(req.messages),
        systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
        generationConfig: {
          temperature: req.temperature ?? 0.4,
          maxOutputTokens: req.maxTokens,
        },
      }),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      yield { type: "text", text: `[google error: ${res.status} ${res.statusText}]` };
      yield { type: "finish" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let approxTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const evt = JSON.parse(dataLine.slice(5).trim());
          const text = evt.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
          if (text) {
            approxTokens += Math.ceil(text.length / 4);
            yield { type: "text", text, tokens: approxTokens };
          }
        } catch (e) {
          log.warn("malformed sse", e);
        }
      }
    }
    yield { type: "finish", tokens: approxTokens };
  },
};
