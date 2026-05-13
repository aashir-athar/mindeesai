/**
 * Ollama provider — the default, free, local-first LLM.
 *
 * We talk to Ollama's native `/api/chat` endpoint directly instead of routing
 * through the `ai` SDK because:
 *  - It exposes streamed thinking content for R1-class models
 *  - It's a single HTTP call → trivial to mock in tests
 *  - We can mark `isAvailable` with a fast probe of `/api/tags`
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk, Message } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("ollama");

let availabilityCache: { value: boolean; expiresAt: number } | null = null;
const AVAILABILITY_TTL_MS = 30_000;

async function probe(): Promise<boolean> {
  if (availabilityCache && availabilityCache.expiresAt > Date.now()) {
    return availabilityCache.value;
  }
  try {
    const res = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    const ok = res.ok;
    availabilityCache = { value: ok, expiresAt: Date.now() + AVAILABILITY_TTL_MS };
    return ok;
  } catch {
    availabilityCache = { value: false, expiresAt: Date.now() + AVAILABILITY_TTL_MS };
    return false;
  }
}

/** Translate our internal Message[] into Ollama's expected wire format. */
function toOllamaMessages(messages: Message[], system?: string) {
  const out: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }> = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/** Properly-awaited probe. Use in the router instead of the synchronous isAvailable(). */
export async function probeOllama(): Promise<boolean> {
  return probe();
}

export const ollamaProvider: LLMProvider = {
  id: "ollama",
  isAvailable() {
    // Synchronous check uses the cached value. First call returns `false`
    // until the async probe completes — better to fall through to a configured
    // cloud provider than to hang on an unreachable Ollama.
    return availabilityCache?.value ?? false;
  },

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = req.modelId ?? env.DEFAULT_CHAT_MODEL;
    const url = `${env.OLLAMA_BASE_URL}/api/chat`;
    const body = {
      model,
      stream: true,
      think: req.thinking ?? false,
      options: {
        temperature: req.temperature ?? 0.4,
        num_predict: req.maxTokens ?? -1,
      },
      messages: toOllamaMessages(req.messages, req.system),
      tools: req.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    };

    log.debug(`POST ${url} model=${model} tools=${req.tools?.length ?? 0}`);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      yield {
        type: "text",
        text: `[ollama error: ${res.status} ${res.statusText}]`,
      };
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
      // Ollama emits newline-delimited JSON
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as {
            message?: { role?: string; content?: string; thinking?: string; tool_calls?: Array<{ id?: string; function: { name: string; arguments: unknown } }> };
            done?: boolean;
            eval_count?: number;
          };
          const content = evt.message?.content ?? "";
          if (evt.message?.thinking) {
            yield { type: "thinking", text: evt.message.thinking };
          }
          if (content) {
            approxTokens += Math.ceil(content.length / 4);
            yield { type: "text", text: content, tokens: approxTokens };
          }
          const calls = evt.message?.tool_calls;
          if (calls && calls.length > 0) {
            for (const c of calls) {
              yield {
                type: "tool-call",
                toolCall: {
                  id: c.id ?? Math.random().toString(36).slice(2),
                  name: c.function.name,
                  args: c.function.arguments,
                },
              };
            }
          }
          if (evt.done) {
            yield { type: "finish", tokens: evt.eval_count ?? approxTokens };
            return;
          }
        } catch (e) {
          log.warn("malformed line", e);
        }
      }
    }
    yield { type: "finish", tokens: approxTokens };
  },
};
