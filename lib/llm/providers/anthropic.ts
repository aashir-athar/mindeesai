/**
 * Anthropic (Claude) provider.
 *
 * Uses the Messages API directly via fetch. Streaming via Server-Sent Events.
 * Activated only when ANTHROPIC_API_KEY is set.
 */

import { env } from "@/lib/env";
import type { LLMProvider, LLMRequest, LLMStreamChunk, Message } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("anthropic");

function toAnthropicMessages(messages: Message[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      // Tool result → user message with a tool_result content block.
      if (m.role === "tool") {
        return {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content },
          ],
        };
      }
      // Assistant turn that EMITTED tool calls → must serialize each call as
      // a tool_use content block alongside any text. Anthropic rejects the
      // request with 400 if the subsequent tool_result block can't find a
      // matching tool_use id in the prior assistant message. Same bug shape
      // as openai.ts fix in commit 0c650e1.
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content && m.content.trim().length > 0) {
          blocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: typeof tc.args === "object" && tc.args !== null ? tc.args : {},
          });
        }
        return { role: "assistant", content: blocks };
      }
      // Plain text turn — works for both user and assistant roles.
      return { role: m.role, content: m.content };
    });
}

export const anthropicProvider: LLMProvider = {
  id: "anthropic",
  isAvailable() {
    return Boolean(env.ANTHROPIC_API_KEY);
  },

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    if (!env.ANTHROPIC_API_KEY) {
      yield { type: "text", text: "[anthropic: no API key configured]" };
      yield { type: "finish" };
      return;
    }
    const model = req.modelId ?? "claude-opus-4-7";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        temperature: req.temperature ?? 0.4,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      yield { type: "text", text: `[anthropic error: ${res.status} ${res.statusText}]` };
      yield { type: "finish" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let approxTokens = 0;
    let toolName = "";
    let toolArgs = "";
    let toolId = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE format: "event: ...\ndata: {...}\n\n"
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
            toolName = evt.content_block.name;
            toolId = evt.content_block.id;
            toolArgs = "";
          } else if (evt.type === "content_block_delta") {
            if (evt.delta?.type === "text_delta") {
              approxTokens += Math.ceil(evt.delta.text.length / 4);
              yield { type: "text", text: evt.delta.text, tokens: approxTokens };
            } else if (evt.delta?.type === "input_json_delta") {
              toolArgs += evt.delta.partial_json;
            }
          } else if (evt.type === "content_block_stop" && toolName) {
            try {
              const args = JSON.parse(toolArgs || "{}");
              yield { type: "tool-call", toolCall: { id: toolId, name: toolName, args } };
            } catch (e) {
              log.warn("bad tool args", e);
            }
            toolName = ""; toolArgs = ""; toolId = "";
          } else if (evt.type === "message_stop") {
            yield { type: "finish", tokens: approxTokens };
            return;
          }
        } catch (e) {
          log.warn("malformed sse", e);
        }
      }
    }
    yield { type: "finish", tokens: approxTokens };
  },
};
