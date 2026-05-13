/**
 * The Orchestrator — MindeesAI's "main loop".
 *
 * v0.2 upgrades:
 *   - Reasoning mode: hard questions get a hidden `<think>` block before the answer.
 *     Streamed to the UI as `reasoning` events so users can opt into seeing the
 *     model's chain of thought.
 *   - All generation flows through the native model via `mindees.*`.
 *   - Tool-call protocol unchanged.
 */

import { generateTextStream, generateWithReasoning } from "@/core/mindees-mind";
import { estimateDifficulty } from "@/core/mindees-mind/inference/reasoning";
import { getActiveSystemPrompt } from "@/lib/prompts";
import { getRegistry, runConnector } from "@/lib/connectors/loader";
import { buildContext } from "@/lib/connectors/context";
import {
  appendMessage,
  rememberMany,
  recall,
  recallInsights,
  readThread,
} from "@/lib/memory";
import { isoNow, nid } from "@/lib/utils";
import type { Citation, Message, ToolCall } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("orchestrator");

const TOOL_OPEN = "<tool>";
const TOOL_CLOSE = "</tool>";
const MAX_TOOL_HOPS = 5;

export type OrchestratorEvent =
  | { type: "stage"; stage: string; detail?: string }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool-start"; name: string; args: unknown; callId: string }
  | { type: "tool-end"; name: string; callId: string; ok: boolean; ms: number }
  | { type: "citation"; citation: Citation }
  | { type: "finish"; message: Message };

export async function* orchestrate(opts: {
  threadId: string;
  userMessage: string;
  signal: AbortSignal;
  user?: { id: string };
  reasoning?: "auto" | "off" | "always";
}): AsyncIterable<OrchestratorEvent> {
  const { threadId, userMessage, signal, user, reasoning = "auto" } = opts;

  const userTurn: Message = {
    id: nid(),
    role: "user",
    content: userMessage,
    createdAt: isoNow(),
  };
  await appendMessage(threadId, userTurn);

  yield { type: "stage", stage: "context" };

  const thread = await readThread(threadId);
  const [memoryHits, insightHits] = await Promise.all([
    recall(userMessage, 6, threadId).catch(() => []),
    recallInsights(userMessage, 4).catch(() => []),
  ]);
  const memoryBlock = formatMemoryBlock(memoryHits, insightHits);

  const basePrompt = await getActiveSystemPrompt();
  const registry = await getRegistry();
  const toolsList = [...registry.values()].map((c) => `- \`${c.manifest.name}\` — ${c.manifest.description}`).join("\n");
  const toolGuidance = [...registry.values()].filter((c) => c.prompt).map((c) => `### ${c.manifest.name}\n${c.prompt}`).join("\n\n");

  const systemPrompt = [
    basePrompt,
    memoryBlock,
    "",
    "## Available tools",
    "Invoke a tool by emitting EXACTLY this JSON block on its own line(s):",
    `${TOOL_OPEN}{"name":"<name>","args":{...}}${TOOL_CLOSE}`,
    "After the block, stop generating. The orchestrator runs the tool and feeds the result back as `<tool-result>{...}</tool-result>`. Then continue.",
    "",
    toolsList,
    toolGuidance ? `\n## Tool-specific guidance\n${toolGuidance}` : "",
  ].join("\n");

  const chatPrompt = formatChatPrompt(systemPrompt, thread, userTurn);

  const decided =
    reasoning === "off" ? null :
    reasoning === "always" ? "deep" as const :
    estimateDifficulty(userMessage);

  let aggregatedText = "";
  let reasoningText = "";
  const citations: Citation[] = [];

  // Reasoning pass for hard problems
  if (decided && decided !== "shallow") {
    yield { type: "stage", stage: "reasoning" };
    const reasoned = await generateWithReasoning(chatPrompt, {
      depth: decided,
      signal,
    });
    reasoningText = reasoned.thinking;
    if (reasoningText) yield { type: "reasoning", text: reasoningText };
    if (reasoned.answer) {
      aggregatedText = reasoned.answer;
      yield { type: "text", text: reasoned.answer };
    }
  }

  // Tool-call loop
  let runningPrompt = aggregatedText ? `${chatPrompt}${aggregatedText}` : chatPrompt;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    yield { type: "stage", stage: hop === 0 && !reasoningText ? "thinking" : "synthesising", detail: hop > 0 ? `hop ${hop}` : undefined };

    let hopBuf = "";
    let toolFound: { call: ToolCall; before: string } | null = null;

    for await (const piece of generateTextStream(runningPrompt, {
      maxTokens: 768,
      temperature: 0.4,
      stop: [TOOL_CLOSE, "<|endoftext|>"],
      signal,
    })) {
      if (signal.aborted) break;
      hopBuf += piece;

      const open = hopBuf.indexOf(TOOL_OPEN);
      const close = hopBuf.indexOf(TOOL_CLOSE);
      if (open >= 0 && close > open) {
        const before = hopBuf.slice(0, open);
        const inner = hopBuf.slice(open + TOOL_OPEN.length, close);
        try {
          const parsed = JSON.parse(inner) as { name: string; args: unknown };
          toolFound = { call: { id: nid(), name: parsed.name, args: parsed.args }, before };
          aggregatedText += before;
          if (before) yield { type: "text", text: before };
          break;
        } catch (e) {
          log.warn("malformed tool call", e);
          aggregatedText += hopBuf;
          yield { type: "text", text: hopBuf };
          hopBuf = "";
          continue;
        }
      } else {
        const lastLT = hopBuf.lastIndexOf("<");
        const safeCut = lastLT < 0 ? hopBuf.length : lastLT;
        if (safeCut > 0) {
          const flushed = hopBuf.slice(0, safeCut);
          aggregatedText += flushed;
          yield { type: "text", text: flushed };
          hopBuf = hopBuf.slice(safeCut);
        }
      }
    }

    if (!toolFound) {
      if (hopBuf) {
        aggregatedText += hopBuf;
        yield { type: "text", text: hopBuf };
      }
      break;
    }

    const tc = toolFound.call;
    const start = performance.now();
    yield { type: "tool-start", name: tc.name, args: tc.args, callId: tc.id };
    const entry = registry.get(tc.name);
    let result: Awaited<ReturnType<typeof runConnector>>;
    if (!entry) {
      result = { ok: false, error: `unknown tool ${tc.name}` };
    } else {
      const ctx = buildContext(entry.manifest, signal, user);
      result = await runConnector(tc.name, tc.args, ctx);
    }
    const ms = performance.now() - start;
    yield { type: "tool-end", name: tc.name, callId: tc.id, ok: result.ok, ms };

    if (result.ok && result.citations) {
      for (const c of result.citations) {
        citations.push(c);
        yield { type: "citation", citation: c };
      }
    }

    const resultText = result.ok
      ? typeof result.output === "string" ? result.output : JSON.stringify(result.output)
      : `Error: ${result.error}`;
    runningPrompt += `\n${TOOL_OPEN}${JSON.stringify({ name: tc.name, args: tc.args })}${TOOL_CLOSE}\n<tool-result>${resultText}</tool-result>\n`;
  }

  const finalAssistant: Message = {
    id: nid(),
    role: "assistant",
    content: aggregatedText.trim(),
    citations,
    thinkingTokens: reasoningText ? reasoningText.length : undefined,
    createdAt: isoNow(),
    modelId: "mindees-native",
  };
  await appendMessage(threadId, finalAssistant);

  await rememberMany([
    { id: userTurn.id, text: userTurn.content, threadId, role: "user", source: "conversation", createdAt: userTurn.createdAt },
    { id: finalAssistant.id, text: finalAssistant.content, threadId, role: "assistant", source: "conversation", createdAt: finalAssistant.createdAt },
  ]).catch((e) => log.warn("memory write failed", e));

  yield { type: "finish", message: finalAssistant };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatMemoryBlock(
  memoryHits: Awaited<ReturnType<typeof recall>>,
  insightHits: Awaited<ReturnType<typeof recallInsights>>,
): string {
  const lines: string[] = [];
  if (insightHits.length > 0) {
    lines.push("\n## Distilled insights from past conversations");
    for (const i of insightHits.slice(0, 4)) lines.push(`- ${i.text}`);
  }
  if (memoryHits.length > 0) {
    lines.push("\n## Relevant memories");
    for (const m of memoryHits.slice(0, 5)) lines.push(`- ${m.text}`);
  }
  return lines.join("\n");
}

function formatChatPrompt(system: string, history: Message[], current: Message): string {
  const parts: string[] = [`<system>${system}</system>`];
  for (const m of history.slice(-12)) {
    if (m.role === "user") parts.push(`<user>${m.content}</user>`);
    else if (m.role === "assistant") parts.push(`<assistant>${m.content}</assistant>`);
    else if (m.role === "tool") parts.push(`<tool-result>${m.content}</tool-result>`);
  }
  parts.push(`<user>${current.content}</user>`);
  parts.push(`<assistant>`);
  return parts.join("\n");
}
