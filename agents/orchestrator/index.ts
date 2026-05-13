/**
 * The Orchestrator — Mindees' main response loop.
 *
 * Inference path:
 *   - All generation goes through `lib/llm/router.streamLLM` (Groq today,
 *     swappable to the native model once a checkpoint exists).
 *   - NO reasoning-mode branch — that path used the random-weight native
 *     model and stalled requests until timeout. It's commented out below
 *     and will be re-enabled the day the native checkpoint lands.
 *
 * Persona:
 *   Every request reads + updates the Mindees mood tensor (8-dim, persistent)
 *   and injects the persona system prompt with current emotional state.
 *   This is what turns the LLM's default register into something that sounds
 *   like an actual continuous entity instead of a fresh model on every turn.
 *
 * Tool-calling:
 *   Providers' native function-calling protocol; surfaced as `tool-call`
 *   chunks the orchestrator runs and feeds back as `tool` messages.
 */

import { streamLLM } from "@/lib/llm/router";
import { getRegistry, runConnector, listTools } from "@/lib/connectors/loader";
import { buildContext } from "@/lib/connectors/context";
import {
  appendMessage,
  rememberMany,
  recall,
  recallInsights,
  readThread,
} from "@/lib/memory";
import { readAffect, updateMood, buildMindeesSystemPrompt } from "@/lib/persona";
import { isoNow, nid } from "@/lib/utils";
import type { Citation, Message, ToolCall, RetrievalHit } from "@/lib/types";
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
  | { type: "mood"; mood: { values: Record<string, number>; steps: number; lastRegister?: string } }
  | { type: "finish"; message: Message };

export async function* orchestrate(opts: {
  threadId: string;
  userMessage: string;
  signal: AbortSignal;
  user?: { id: string };
  modelId?: string;
}): AsyncIterable<OrchestratorEvent> {
  const { threadId, userMessage, signal, user, modelId } = opts;

  // 1. Append user turn (sync — needed before recall so the new message is in history)
  const userTurn: Message = {
    id: nid(),
    role: "user",
    content: userMessage,
    createdAt: isoNow(),
  };
  await appendMessage(threadId, userTurn);

  // 2. Update Mindees' mood tensor with this turn's affect — BEFORE generating
  //    so the system prompt reflects the current emotional state.
  const affect = readAffect(userMessage);
  const mood = await updateMood(affect);
  yield { type: "mood", mood: { values: mood.values, steps: mood.steps, lastRegister: mood.lastRegister } };

  yield { type: "stage", stage: "context" };

  // 3. Assemble context in parallel
  const thread = await readThread(threadId);
  const [memoryHits, insightHits] = await Promise.all([
    recall(userMessage, 6, threadId).catch(() => [] as RetrievalHit[]),
    recallInsights(userMessage, 4).catch(() => [] as RetrievalHit[]),
  ]);
  const memoryBlock = formatMemoryBlock(memoryHits, insightHits);

  // 4. Build the Mindees system prompt — persona + current mood + memory + tools
  const registry = await getRegistry();
  const toolGuidance = [...registry.values()]
    .filter((c) => c.prompt)
    .map((c) => `### ${c.manifest.name}\n${c.prompt}`)
    .join("\n\n");
  const toolsBlock = toolGuidance
    ? `# Tool-specific guidance\n${toolGuidance}`
    : undefined;

  const systemPrompt = buildMindeesSystemPrompt({
    mood,
    memoryBlock,
    toolsBlock,
  });

  const tools = await listTools();

  // 5. Conversation history — last 12 turns
  const history: Message[] = [...thread, userTurn].slice(-13);

  // 6. Tool-call loop — streams text directly to the UI, runs connectors when
  //    the model emits structured tool_calls.
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
      thinking: false, // never trigger native-model reasoning path
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

    if (hopReasoning) yield { type: "reasoning", text: hopReasoning };
    if (pendingTools.length === 0) break;

    const assistantToolTurn: Message = {
      id: nid(),
      role: "assistant",
      content: hopText,
      toolCalls: pendingTools,
      createdAt: isoNow(),
    };
    conversation = [...conversation, assistantToolTurn];

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

  // 7. Persist final turn + memory
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
