/**
 * OpenAI-compatible streaming.
 *
 * Exports `streamOpenAICompatible` which any provider with an OpenAI-shaped
 * Chat Completions endpoint can call (Groq, xAI, Together, Mistral, etc.).
 * The OpenAI provider itself is a thin wrapper over that helper.
 *
 * Why this refactor: the previous design called `openaiProvider.stream()`
 * from Groq/xAI with a patched `global.fetch`. That was fragile and — more
 * importantly — the inner `openaiProvider.stream()` checked
 * `env.OPENAI_API_KEY` first thing and bailed out with
 * "[openai: no API key configured]" even when the caller was Groq or xAI.
 * That's the user-facing bug we just hit.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk, Message } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("openai-compat");

function toOpenAIMessages(messages: Message[], system?: string) {
  const out: Array<Record<string, unknown>> = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export interface OpenAICompatibleOptions {
  /** e.g. "https://api.openai.com/v1" — no trailing slash. */
  baseUrl: string;
  apiKey: string;
  /** Display name used in error messages and logs. */
  label: string;
  /** Default model when req.modelId is absent. */
  defaultModel: string;
}

/** Stream a chat completion from any OpenAI-compatible endpoint. */
export async function* streamOpenAICompatible(
  req: LLMRequest,
  opts: OpenAICompatibleOptions,
): AsyncIterable<LLMStreamChunk> {
  if (!opts.apiKey) {
    yield { type: "text", text: `[${opts.label}: no API key configured]` };
    yield { type: "finish" };
    return;
  }

  const model = req.modelId ?? opts.defaultModel;
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens,
      messages: toOpenAIMessages(req.messages, req.system),
      tools: req.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    }),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    yield {
      type: "text",
      text: `[${opts.label} error: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}]`,
    };
    yield { type: "finish" };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let approxTokens = 0;
  const toolBuffers = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        for (const tb of toolBuffers.values()) {
          try {
            yield { type: "tool-call", toolCall: { id: tb.id, name: tb.name, args: JSON.parse(tb.args || "{}") } };
          } catch (e) {
            log.warn("bad tool args", e);
          }
        }
        yield { type: "finish", tokens: approxTokens };
        return;
      }
      try {
        const evt = JSON.parse(payload);
        const delta = evt.choices?.[0]?.delta;
        if (delta?.content) {
          approxTokens += Math.ceil(delta.content.length / 4);
          yield { type: "text", text: delta.content, tokens: approxTokens };
        }
        if (delta?.reasoning_content) {
          yield { type: "thinking", text: delta.reasoning_content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolBuffers.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolBuffers.set(idx, existing);
          }
        }
      } catch (e) {
        log.warn("malformed sse", e);
      }
    }
  }
  yield { type: "finish", tokens: approxTokens };
}

export const openaiProvider: LLMProvider = {
  id: "openai",
  isAvailable() {
    return Boolean(env.OPENAI_API_KEY);
  },
  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    yield* streamOpenAICompatible(req, {
      baseUrl: "https://api.openai.com/v1",
      apiKey: env.OPENAI_API_KEY ?? "",
      label: "openai",
      defaultModel: "gpt-5",
    });
  },
};
