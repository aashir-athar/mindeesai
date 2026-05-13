/**
 * The Orchestrator — Mindees' main response loop.
 *
 * Inference: streamLLM (Groq today, native model when checkpointed).
 * Persona:   five persistent tensors updated per turn —
 *              mood (8d), user model (16d), relationship (4d),
 *              curiosity gap (scalar), drift fingerprint (5d).
 *            Plus a reward predictor from accumulated thumb signals.
 *
 * Every tensor is real persistent state. None of this is roleplay theatre —
 * each value can be inspected at /api/mood, /api/persona, etc.
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
import { persistPersonaQuick } from "@/lib/memory/persistence";
import { touchMeta, getMeta } from "@/lib/threads/metadata";
import { generateThreadTitle } from "@/lib/threads/title";
import {
  readAffect,
  updateMood,
  getUserModel,
  applyTurnToUserModel,
  persistUserModel,
  getRelationship,
  applyTurnToRelationship,
  persistRelationship,
  curiosityGap,
  recordDriftFromReply,
  predictReward,
  buildMindeesSystemPrompt,
} from "@/lib/persona";
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

  // 1. Append user turn
  const userTurn: Message = {
    id: nid(),
    role: "user",
    content: userMessage,
    createdAt: isoNow(),
  };
  await appendMessage(threadId, userTurn);

  // 2. Read affect → update all per-turn tensors in parallel
  const affect = readAffect(userMessage);
  const [mood, userModelPrev, relPrev] = await Promise.all([
    updateMood(affect),
    getUserModel(threadId),
    getRelationship(threadId),
  ]);

  // Running average user-message length, used by the user model
  const thread = await readThread(threadId);
  const userMessages = [...thread, userTurn].filter((m) => m.role === "user");
  const runningAvgLen =
    userMessages.reduce((sum, m) => sum + m.content.length, 0) / Math.max(1, userMessages.length);

  const userModelNext = applyTurnToUserModel(userModelPrev, {
    text: userMessage,
    affect,
    runningAvgLen,
  });
  const relationshipNext = applyTurnToRelationship(relPrev, affect);

  // Persist — async, don't block the response
  void persistUserModel(userModelNext);
  void persistRelationship(relationshipNext);

  yield { type: "mood", mood: { values: mood.values, steps: mood.steps, lastRegister: mood.lastRegister } };
  yield { type: "stage", stage: "context" };

  // 3. Retrieve memories + insights + curiosity gap from those scores
  const [memoryHits, insightHits] = await Promise.all([
    recall(userMessage, 6, threadId).catch(() => [] as RetrievalHit[]),
    recallInsights(userMessage, 4).catch(() => [] as RetrievalHit[]),
  ]);
  const memoryBlock = formatMemoryBlock(memoryHits, insightHits);
  const curiosity = curiosityGap(memoryHits);

  // 4. Aggregate reward signal from historical thumbs (cached)
  const reward = await predictReward();

  // 5. Get the prior drift state so we can re-anchor if needed
  //    (we check the state from the PREVIOUS reply — the new reply will be
  //    measured at end-of-turn and stored for next time)
  let reanchorNeeded = false;
  try {
    const { getDriftState, fingerprint, distance: dfn } = await import("@/lib/persona/drift");
    const drift = await getDriftState();
    const last = drift.history.at(-1);
    if (last) {
      reanchorNeeded = last.asAiFlag === 1 || last.corpoOpenerFlag === 1 || dfn(last) > 0.9;
    }
    void fingerprint; // referenced for completeness
  } catch { /* ignore */ }

  // 6. Compose the Mindees system prompt with EVERY tensor narrated in
  const registry = await getRegistry();
  const toolGuidance = [...registry.values()]
    .filter((c) => c.prompt)
    .map((c) => `### ${c.manifest.name}\n${c.prompt}`)
    .join("\n\n");
  const toolsBlock = toolGuidance ? `# Tool-specific guidance\n${toolGuidance}` : undefined;

  const systemPrompt = buildMindeesSystemPrompt({
    mood,
    user: userModelNext,
    relationship: relationshipNext,
    curiosity,
    reward,
    reanchorNeeded,
    memoryBlock,
    toolsBlock,
  });

  const tools = await listTools();
  const history: Message[] = [...thread, userTurn].slice(-13);

  // 7. Tool-call loop
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
      thinking: false,
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
      id: nid(), role: "assistant", content: hopText, toolCalls: pendingTools, createdAt: isoNow(),
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
        { id: nid(), role: "tool", content, toolCallId: tc.id, createdAt: isoNow() },
      ];
    }
  }

  // 8. Finalize: persist turn, update memory, record drift fingerprint
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

  void recordDriftFromReply(finalAssistant.content);

  // Thread metadata: titled on first turn, lastActivity bumped every turn
  const priorMeta = await getMeta(threadId);
  const isFirstTurn = !priorMeta || priorMeta.turns === 0;
  await touchMeta(threadId, {
    turns: (priorMeta?.turns ?? 0) + 1,
    preview: priorMeta?.preview || userMessage.slice(0, 120),
    lastUserMsg: userMessage.slice(0, 120),
    lastAssistantMsg: finalAssistant.content.slice(0, 120),
  });
  if (isFirstTurn && finalAssistant.content) {
    // Fire-and-forget title generation
    void (async () => {
      const title = await generateThreadTitle({
        firstUserMessage: userMessage,
        firstAssistantReply: finalAssistant.content,
      });
      if (title) await touchMeta(threadId, { title });
    })();
  }

  yield { type: "finish", message: finalAssistant };

  // After the user has their final message, push the persona tensors to
  // Vercel Blob so they persist across function cold starts. Fire-and-await
  // — the connection stays open for ~1-2s longer but the user already has
  // their content rendered.
  try {
    await persistPersonaQuick();
  } catch (e) {
    log.warn("persona quick-flush after chat failed", e);
  }
}

function formatMemoryBlock(
  memoryHits: RetrievalHit[],
  insightHits: RetrievalHit[],
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
