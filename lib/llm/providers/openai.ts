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

/** Typed provider error so the router can detect rate limits and walk the fallback chain. */
export class ProviderError extends Error {
  status?: number;
  provider?: string;
  isRateLimit?: boolean;
}

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
  // Hard 15s timeout per provider — combined with the abort signal from
  // the caller. Without this cap, a rate-limited provider can hang the
  // whole fetch indefinitely (no default timeout in Node fetch), which
  // cascades through the router's fallback chain and burns the cron's
  // wall-clock budget.
  const providerTimeout = AbortSignal.timeout(15_000);
  const combinedSignal = req.signal
    ? AbortSignal.any([req.signal, providerTimeout])
    : providerTimeout;

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
    signal: combinedSignal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    // THROW instead of yielding the raw error text — the router catches
    // 429/5xx and walks the fallback chain to keep the chat alive.
    // The pre-Phase-fix behaviour leaked raw provider error JSON into the
    // user-visible reply, which broke the persona AND wasn't actionable.
    const err = new ProviderError(`${opts.label} ${res.status} ${res.statusText} — ${detail.slice(0, 400)}`);
    err.status = res.status;
    err.provider = opts.label;
    err.isRateLimit = res.status === 429 ||
      detail.includes("rate limit") || detail.includes("rate_limit") ||
      detail.includes("Rate limit") || detail.includes("Too Many Requests");
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let approxTokens = 0;
  const toolBuffers = new Map<number, { id: string; name: string; args: string }>();

  // Per-CHUNK stall timeout. The fetch-level AbortSignal.timeout above only
  // protects the handshake — once the stream opens, reader.read() blocks
  // indefinitely if the server keeps the connection alive but never sends
  // a chunk. That's the exact failure mode behind the "Composing Answer…
  // stuck forever" bug: model returns 200 OK on a synthesis hop, then
  // never streams a token (some safety classifier triggered, model
  // overloaded, etc.). Race each read against a 25s timer; on stall, throw
  // a typed ProviderError so the router walks to the next fallback model.
  const CHUNK_STALL_MS = 25_000;

  while (true) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("stream stalled — no chunk in 25s")), CHUNK_STALL_MS),
        ),
      ]);
    } catch (e) {
      // Cancel the underlying response so we don't leak the connection.
      try { await reader.cancel(); } catch { /* ignore */ }
      const err = new ProviderError(`${opts.label} stream stalled: ${(e as Error).message}`);
      err.status = 504;
      err.provider = opts.label;
      err.isRateLimit = false;
      throw err;
    }
    const { done, value } = readResult;
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
