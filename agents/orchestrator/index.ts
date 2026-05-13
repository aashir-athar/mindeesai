/**
 * The Orchestrator — MindeesAI's "main loop".
 *
 * Inference path (v0.2.1):
 *   - **Today:** delegates to `lib/llm/router.streamLLM`, which routes to the
 *     first configured cloud provider (Anthropic → xAI → OpenAI → Groq →
 *     Google) or falls back to a reachable Ollama instance.
 *   - **Future:** when `checkpoints/base.bin` exists (pretrained native model),
 *     a flag will flip the orchestrator to use `mindees.generateTextStream`.
 *     The native model's *training* pipeline is already running every 5 minutes
 *     and ingesting these conversations — see [[self-improvement-loop]].
 *
 * Why the LLM router today?
 *   The native model's weights are randomly initialised. Without pretraining
 *   it can't produce coherent text. Until a checkpoint is minted, the LLM
 *   router IS the working inference engine. This is the standard bootstrap
 *   pattern for self-training systems.
 *
 * Tool-calling:
 *   We use the providers' native function-calling protocol (OpenAI-compatible
 *   `tool_calls`), surfaced by the router as `{ type: "tool-call", toolCall }`
 *   chunks. The orchestrator runs the connector, appends a tool-result
 *   message to the history, and loops the LLM with the updated history.
 */

import { streamLLM } from "@/lib/llm/router";
import { getActiveSystemPrompt } from "@/lib/prompts";
import { getRegistry, runConnector, listTools } from "@/lib/connectors/loader";
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
  /** Override the LLM model (e.g., "anthropic:claude-opus-4-7", "groq:llama-3.3-70b-versatile"). */
  modelId?: string;
}): AsyncIterable<OrchestratorEvent> {
  const { threadId, userMessage, signal, user, modelId } = opts;

  // 1. Append user turn to thread + memory
  const userTurn: Message = {
    id: nid(),
    role: "user",
    content: userMessage,
    createdAt: isoNow(),
  };
  await appendMessage(threadId, userTurn);

  yield { type: "stage", stage: "context" };

  // 2. Assemble context in parallel
  const thread = await readThread(threadId);
  const [memoryHits, insightHits] = await Promise.all([
    recall(userMessage, 6, threadId).catch(() => []),
    recallInsights(userMessage, 4).catch(() => []),
  ]);
  const memoryBlock = formatMemoryBlock(memoryHits, insightHits);

  // 3. System prompt + tool descriptors
  const basePrompt = await getActiveSystemPrompt();
  const registry = await getRegistry();
  const toolGuidance = [...registry.values()]
    .filter((c) => c.prompt)
    .map((c) => `### ${c.manifest.name}\n${c.prompt}`)
    .join("\n\n");
  const systemPrompt = [basePrompt, memoryBlock, toolGuidance ? `\n## Tool-specific guidance\n${toolGuidance}` : ""]
    .filter(Boolean)
    .join("\n");

  const tools = await listTools();

  // 4. Conversation history — last 12 turns, excluding the current user turn
  //    (it's appended last so the model knows what to answer)
  const history: Message[] = [...thread, userTurn].slice(-13);

  // 5. Tool-call loop
  let aggregatedText = "";
  const citations: Citation[] = [];
  let conversation: Message[] = history;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    yield { type: "stage", stage: hop === 0 ? "thinking" : "synthesising", detail: hop > 0 ? `hop ${hop}` : undefined };

    let hopText = "";
    let hopReasoning = "";
    const pendingTools: ToolCall[] = [];

    for await (const chunk of streamLLM({
      modelId,
      messages: conversation,
      system: systemPrompt,
      tools,
      signal,
      thinking: true,
    })) {
      if (signal.aborted) break;
      if (chunk.type === "text" && chunk.text) {
        hopText += chunk.text;
        aggregatedText += chunk.text;
        yield { type: "text", text: chunk.text };
      } else if (chunk.type === "thinking" && chunk.text) {
        hopReasoning += chunk.text;
      } else if (chunk.type === "tool-call" && chunk.toolCall) {
        pendingTools.push(chunk.toolCall);
      } else if (chunk.type === "finish") {
        break;
      }
    }

    if (hopReasoning) {
      yield { type: "reasoning", text: hopReasoning };
    }

    if (pendingTools.length === 0) break;

    // Record the assistant turn that issued the tool calls
    const assistantToolTurn: Message = {
      id: nid(),
      role: "assistant",
      content: hopText,
      toolCalls: pendingTools,
      createdAt: isoNow(),
    };
    conversation = [...conversation, assistantToolTurn];

    // Run each tool sequentially (parallel is possible but tool ordering matters for citations)
    for (const tc of pendingTools) {
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

      const content = result.ok
        ? typeof result.output === "string" ? result.output : JSON.stringify(result.output)
        : `Error: ${result.error}`;

      conversation = [
        ...conversation,
        {
          id: nid(),
          role: "tool",
          content,
          toolCallId: tc.id,
          createdAt: isoNow(),
        },
      ];
    }
  }

  // 6. Final assistant turn
  const finalAssistant: Message = {
    id: nid(),
    role: "assistant",
    content: aggregatedText.trim(),
    citations,
    createdAt: isoNow(),
    modelId: modelId ?? "router-auto",
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
