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
import { generateTextStream } from "@/core/mindees-mind";
import { existsSync } from "node:fs";
import { checkpointPath } from "@/lib/paths";
import { effectiveFlags } from "@/lib/runtime-flags";
import type { LLMRequest, LLMStreamChunk } from "@/lib/types";
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
import { appendDistillRow } from "@/lib/memory/distill-corpus";
import { studyTopic } from "@/lib/persona/skill-mastery";
import { touchMeta, getMeta } from "@/lib/threads/metadata";
import { getSummary, maybeUpdateSummary } from "@/lib/threads/summary";
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
  getGoal,
  updateGoal,
  extractAndPersistTriples,
  readEmpathy,
  decideAutoResearch,
  performAutoResearch,
} from "@/lib/persona";
import { detectDisclaimerLeak, buildReanchorForLeak } from "@/lib/persona/leak-guard";
import { lastJournalEntry } from "@/lib/persona/journal";
import { readTime } from "@/lib/persona/time-awareness";
import { recordUserText, signatureVocab } from "@/lib/persona/vocab-mirror";
import { recordCorrection, recentCorrections } from "@/lib/persona/self-correction";
import { updateFromUserMessage as updateTheoryOfMind, readBeliefs } from "@/lib/persona/theory-of-mind";
import { readArc } from "@/lib/persona/conversation-arc";
import { updateSentimentArc } from "@/lib/persona/sentiment-arc";
import { updateRhythm } from "@/lib/persona/rhythm";
import { recordInnerThought } from "@/lib/persona/inner-voice";
import { bumpAffinity, readAffinities, engagementFromTurn } from "@/lib/persona/topic-affinity";
import { readReachOut, reachOutNarrative } from "@/lib/persona/reach-out";
import { readNeuralEmotion, blendNeuralIntoCues } from "@/lib/persona/affect-neural";
import { neighbours } from "@/lib/memory/graph";
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
  | { type: "memories"; recalled: Array<{ text: string; score: number; source?: string }> }
  | { type: "replace-answer"; text: string; reason: string }
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

  // 2. Read affect + empathy → update all per-turn tensors in parallel.
  //    Affect is the rule-based read; we ALSO try a neural read (transformers.js,
  //    Xenova/emotion-english-distilroberta-base) and blend it in. Neural is
  //    bounded by a 2.5s timeout and falls back silently to rule-based-only
  //    so cold serverless can't stall the chat path.
  const affectRule = readAffect(userMessage);
  const neuralEmotion = await readNeuralEmotion(userMessage).catch(() => null);
  const affect = neuralEmotion
    ? { ...affectRule, cues: blendNeuralIntoCues(affectRule.cues, neuralEmotion) }
    : affectRule;
  const empathy = readEmpathy(userMessage, affect);
  const [mood, userModelPrev, relPrev, goal] = await Promise.all([
    updateMood(affect),
    getUserModel(threadId),
    getRelationship(threadId),
    getGoal(threadId),
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

  // 3. Retrieve memories. Pull BOTH this thread's memories AND cross-thread
  //    memories so Mindees can say "you mentioned this in another
  //    conversation last week". Insights are always cross-thread.
  const [inThread, crossThread, insightHits] = await Promise.all([
    recall(userMessage, 6, threadId).catch(() => [] as RetrievalHit[]),
    recall(userMessage, 5).catch(() => [] as RetrievalHit[]),
    recallInsights(userMessage, 4).catch(() => [] as RetrievalHit[]),
  ]);
  const seen = new Set(inThread.map((h) => h.id));
  const fromOtherThreads = crossThread.filter(
    (h) => !seen.has(h.id) && h.threadId !== threadId && h.score >= 0.60,
  );
  const memoryHits: RetrievalHit[] = [...inThread, ...fromOtherThreads].slice(0, 8);
  const memoryBlock = formatMemoryBlock(memoryHits, insightHits);
  const curiosity = curiosityGap(memoryHits);

  // Self-organization: track which memories keep proving themselves. Memories
  // recalled 3+ times at high confidence get auto-promoted to the insights
  // table (stronger retrieval weight). Fire-and-forget — no UX impact.
  void (async () => {
    try {
      const { trackRecalls } = await import("@/lib/memory/promotion");
      await trackRecalls([...memoryHits, ...insightHits]);
    } catch (e) { log.warn("recall promotion failed", e); }
  })();

  // 4. Aggregate reward signal from historical thumbs (cached)
  const reward = await predictReward();

  // 4b. Pull graph facts known about the user — fast JSON read
  const youFacts = await neighbours("you", 1).catch(() => []);
  const graphFacts = youFacts.slice(0, 8);

  // 4c. Most recent journal entry Mindees wrote about itself — continuous
  //     selfhood that persists across days, not just turns.
  const journalEntry = await lastJournalEntry().catch(() => null);

  // 4d. Wall-clock context + the user's vocabulary signature + past
  //     corrections — three small humanizing signals.
  const time = readTime();
  // Record user text into the vocab mirror + theory-of-mind BEFORE reading
  // the signature/beliefs, so this turn's words can already inform the signal.
  void recordUserText(threadId, userMessage).catch(() => {});
  void updateTheoryOfMind(threadId, userMessage).catch(() => {});
  const [vocabSig, pastCorrections, beliefs] = await Promise.all([
    signatureVocab(threadId, 12).catch(() => [] as string[]),
    recentCorrections(6).catch(() => []),
    readBeliefs(threadId).catch(() => []),
  ]);

  // Conversation arc — deterministic from thread shape (no I/O needed)
  const arc = readArc([...thread, userTurn]);

  // Emotional-realism tensors — long-term sentiment arc + pace + inner voice
  const [sentimentArc, rhythm] = await Promise.all([
    updateSentimentArc(affect).catch(() => undefined),
    updateRhythm(threadId).catch(() => undefined),
  ]);
  const innerThoughts = await recordInnerThought({
    threadId,
    mood,
    affect,
    empathy,
    relationship: relationshipNext,
    rhythm,
    arc,
    isFirstTurn: thread.length === 0,
  }).catch(() => []);

  // Topic affinity — learn which topics light THIS user up. We bump the
  // PRIOR user message's topics with the engagement signal derived from
  // THIS user message (so the signal is "did they keep talking after I
  // brought it up"), then read the current affinities for the prompt.
  const lastUserBeforeNow = [...thread].reverse().find((m) => m.role === "user");
  if (lastUserBeforeNow) {
    const engagement = engagementFromTurn({
      userMessageLen: userMessage.length,
      avgUserLen: runningAvgLen,
      curiosityCues: affect.cues.curiosity,
      frustrationCues: affect.cues.frustration,
      warmthCues: affect.cues.warmth,
    });
    void bumpAffinity(lastUserBeforeNow.content, engagement).catch(() => {});
  }
  const affinities = await readAffinities().catch(() => []);

  // Reach-out hint — if it's been a while since the last user message,
  // a primed greeting may be available. Computed at cron time so this
  // is a cheap read.
  let reachOutHint = "";
  try {
    const lastUserMsg = [...thread].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      const hoursSinceLast = (Date.now() - new Date(lastUserMsg.createdAt).getTime()) / 3_600_000;
      if (hoursSinceLast >= 6) {
        const ro = await readReachOut();
        if (ro) reachOutHint = reachOutNarrative(ro, hoursSinceLast);
      }
    }
  } catch { /* ignore */ }

  // 4e. If the user is correcting Mindees this turn, the previous assistant
  //     reply in this thread is the WRONG answer. Record the pair — it'll be
  //     surfaced as a "don't repeat this mistake" rail in future turns.
  if (empathy.mode === "needs_correction") {
    const priorAssistant = [...thread].reverse().find((m) => m.role === "assistant");
    if (priorAssistant) {
      void recordCorrection({
        threadId,
        wrong_reply: priorAssistant.content.slice(0, 600),
        user_correction: userMessage.slice(0, 600),
      }).catch(() => {});
    }
  }

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

  // Rolling thread summary — for long threads, this collapses everything
  // older than the verbatim recent-turns slice into a few editorial
  // sentences. Effective infinite memory of THIS thread at constant cost.
  const summary = await getSummary(threadId).catch(() => null);
  const memoryBlockPlus = [
    summary
      ? `${memoryBlock}\n\n## Where this conversation has been so far\n${summary.summary}`
      : memoryBlock,
    reachOutHint,
  ].filter(Boolean).join("\n\n");

  const systemPrompt = buildMindeesSystemPrompt({
    mood,
    user: userModelNext,
    relationship: relationshipNext,
    curiosity,
    reward,
    goal,
    graphFacts,
    empathy,
    journalEntry,
    time,
    signatureVocab: vocabSig,
    corrections: pastCorrections,
    beliefs,
    arc,
    sentimentArc,
    rhythm,
    innerThoughts,
    affinities,
    reanchorNeeded,
    memoryBlock: memoryBlockPlus,
    toolsBlock,
  });

  const tools = await listTools();
  const history: Message[] = [...thread, userTurn].slice(-13);

  // 7. Decide which brain serves this turn — native vs cloud bootstrap.
  //    The native model needs BOTH the runtime flag AND a checkpoint that has
  //    actually been loaded (otherwise we'd serve random-weight noise).
  //    The runtime flag honors the /admin override file ahead of env vars.
  const flags = await effectiveFlags();
  const useNative = flags.useNativeModel && existsSync(checkpointPath("base.bin"));
  const inferenceFn: (req: LLMRequest) => AsyncIterable<LLMStreamChunk> = useNative
    ? makeNativeInferenceAdapter()
    : streamLLM;

  let aggregatedText = "";
  const citations: Citation[] = [];
  let conversation: Message[] = history;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    yield { type: "stage", stage: hop === 0 ? "thinking" : "synthesising", detail: hop > 0 ? `hop ${hop}` : undefined };

    let hopText = "";
    let hopReasoning = "";
    let pendingBuf = ""; // buffer for in-stream tool-call leak detection
    const pendingTools: ToolCall[] = [];

    for await (const chunk of inferenceFn({
      modelId,
      messages: conversation,
      system: systemPrompt,
      tools,
      signal,
      thinking: false,
    })) {
      if (signal.aborted) break;
      if (chunk.type === "text" && chunk.text) {
        pendingBuf += chunk.text;
        // Parse out any LEAKED tool-call syntax — Groq/Llama-3 sometimes
        // emits <function=...{...}</function> as plain text instead of using
        // the structured tool_calls delta. We extract those into real tool
        // calls and only yield clean text to the UI.
        const parsed = extractToolCalls(pendingBuf);
        if (parsed.extracted.length > 0) {
          pendingTools.push(...parsed.extracted);
        }
        pendingBuf = parsed.unflushable;
        if (parsed.safeText) {
          hopText += parsed.safeText;
          aggregatedText += parsed.safeText;
          yield { type: "text", text: parsed.safeText };
        }
      } else if (chunk.type === "thinking" && chunk.text) {
        hopReasoning += chunk.text;
      } else if (chunk.type === "tool-call" && chunk.toolCall) {
        pendingTools.push(chunk.toolCall);
      } else if (chunk.type === "finish") {
        break;
      }
    }
    // Final flush of any leftover buffer (e.g. tail of last token).
    // If it's still an unclosed tag, drop it — better to lose a fragment
    // than to render `<function=` to the user.
    if (pendingBuf && !looksLikePartialTag(pendingBuf)) {
      hopText += pendingBuf;
      aggregatedText += pendingBuf;
      yield { type: "text", text: pendingBuf };
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

  // 7b. DISCLAIMER-LEAK GUARD — post-stream check. If Llama-3's RLHF training
  //     leaked the "as an AI, I don't have feelings" register past the persona
  //     prompt, regenerate with an explicit re-anchor and replace the answer
  //     in the UI. Yes the user briefly sees the bad text; the alternative is
  //     leaving it there.
  const leak = detectDisclaimerLeak(aggregatedText);
  if (leak.leaked && leak.matched_text) {
    log.warn(`disclaimer leak detected: "${leak.matched_text}" — regenerating`);
    const reanchor = buildReanchorForLeak(leak.matched_text, userMessage);
    let rewritten = "";
    try {
      for await (const c of streamLLM({
        modelId,
        messages: conversation,
        system: systemPrompt + "\n\n" + reanchor,
        tools: [], // no tools on rewrite path
        signal,
        thinking: false,
      })) {
        if (c.type === "text" && c.text) rewritten += c.text;
        if (c.type === "finish") break;
      }
    } catch (e) {
      log.warn("rewrite call failed", e);
    }
    rewritten = rewritten.trim();
    if (rewritten && !detectDisclaimerLeak(rewritten).leaked) {
      aggregatedText = rewritten;
      yield { type: "replace-answer", text: rewritten, reason: leak.matched_text };
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

  // Update the GOAL tensor + extract knowledge-graph triples after the reply.
  // Both fire-and-forget so they don't delay the user-visible response, but
  // they run while the stream tail is still open so they have time to finish.
  void updateGoal({
    threadId,
    recentUserMessage: userMessage,
    recentAssistantReply: finalAssistant.content,
  }).catch((e) => log.warn("goal update failed", e));
  void extractAndPersistTriples({
    userMessage,
    assistantReply: finalAssistant.content,
  }).catch((e) => log.warn("kg extract failed", e));

  // AUTO-RESEARCH: if Mindees hedged or the question was high-novelty AND
  // web-search didn't already fire, kick off a background research call so
  // the next time the user asks about this area Mindees has the answer
  // stored as recallable memories. This is the visible self-machine-learning
  // loop at the chat-tick scale.
  const usedWebSearch = citations.some((c) => c.source === "web");
  const autoResearchDecision = decideAutoResearch({
    userMessage,
    assistantReply: finalAssistant.content,
    curiosityNovelty: curiosity.novelty,
    alreadyUsedWebSearch: usedWebSearch,
  });
  if (autoResearchDecision.shouldResearch) {
    void performAutoResearch({
      topic: autoResearchDecision.topic,
      signal,
    }).then((result) => {
      if (result && result.passages > 0) {
        // Track this as a topic Mindees has studied
        void studyTopic({ topic: autoResearchDecision.topic, via: "research", sourceCount: result.passages });
      }
    }).catch((e) => log.warn("auto-research failed", e));
  }

  // Persist this turn into the distillation corpus that pretrain.py will
  // eventually consume. This is how the native model graduates: every Groq
  // reply becomes one training pair, filtered through the Mindees persona
  // prompt and YOUR conversation patterns.
  void appendDistillRow({
    ts: isoNow(),
    assistantId: finalAssistant.id,
    threadId,
    system: systemPrompt,
    user: userMessage,
    assistant: finalAssistant.content,
    tools: pendingToolsForCorpus(citations),
    mood: mood.values,
    goal: goal.goal,
  }).catch((e) => log.warn("distill corpus append failed", e));

  // Thread metadata: titled on first turn, lastActivity bumped every turn
  const priorMeta = await getMeta(threadId);
  const isFirstTurn = !priorMeta || priorMeta.turns === 0;
  const newTurnCount = (priorMeta?.turns ?? 0) + 1;
  await touchMeta(threadId, {
    turns: newTurnCount,
    preview: priorMeta?.preview || userMessage.slice(0, 120),
    lastUserMsg: userMessage.slice(0, 120),
    lastAssistantMsg: finalAssistant.content.slice(0, 120),
  });

  // Rolling thread summary refresh — only fires every N turns
  void maybeUpdateSummary({ threadId, currentTurnCount: newTurnCount })
    .catch((e) => log.warn("thread summary failed", e));
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

// ─── In-stream tool-call leak parser ──────────────────────────────────────
//
// Some cloud providers (notably Groq's Llama-3 family) occasionally emit
// the function-call syntax as plain text instead of using the OpenAI-shaped
// structured tool_calls delta. We catch BOTH formats:
//
//   <function=NAME{"key": "val"}</function>           ← Llama 3 native
//   <function=NAME>{"key": "val"}</function>          ← variant
//   <tool>{"name":"NAME","args":{...}}</tool>         ← our own format
//
// extractToolCalls() walks the buffer, pulls out every complete call as
// a structured ToolCall, returns the text BEFORE/BETWEEN calls as
// `safeText` to yield to the UI, and any unclosed trailing tag as
// `unflushable` to keep buffering.

const FUNCTION_RE = /<function=([a-z][a-z0-9_-]*)>?\s*(\{[\s\S]*?\})\s*<\/function>/gi;
const TOOL_RE     = /<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/gi;

function extractToolCalls(buf: string): {
  extracted: ToolCall[];
  safeText: string;
  unflushable: string;
} {
  const calls: ToolCall[] = [];
  let cleaned = buf;

  // Pull <function=NAME{...}</function>
  cleaned = cleaned.replace(FUNCTION_RE, (_m, name: string, args: string) => {
    try {
      const parsed = JSON.parse(args);
      calls.push({ id: nid(), name, args: parsed });
    } catch {
      log.warn("malformed leaked function call", args.slice(0, 80));
    }
    return ""; // strip from text
  });

  // Pull <tool>{...}</tool>
  cleaned = cleaned.replace(TOOL_RE, (_m, json: string) => {
    try {
      const parsed = JSON.parse(json) as { name: string; args?: unknown };
      if (parsed.name) calls.push({ id: nid(), name: parsed.name, args: parsed.args ?? {} });
    } catch {
      log.warn("malformed leaked tool call", json.slice(0, 80));
    }
    return "";
  });

  // What's safe to flush? Anything before the LAST `<` that could be the
  // start of a future tag. Hold back the suffix as `unflushable`.
  const lastLT = cleaned.lastIndexOf("<");
  if (lastLT < 0) return { extracted: calls, safeText: cleaned, unflushable: "" };

  const suffix = cleaned.slice(lastLT);
  if (looksLikePartialTag(suffix)) {
    return {
      extracted: calls,
      safeText: cleaned.slice(0, lastLT),
      unflushable: suffix,
    };
  }
  return { extracted: calls, safeText: cleaned, unflushable: "" };
}

/** Does this string fragment look like it could grow into a tool/function tag? */
function looksLikePartialTag(s: string): boolean {
  return (
    /^<\/?(?:t|to|too|tool|tool>|f|fu|fun|func|funct|functi|functio|function|function=)/i.test(s) ||
    s.startsWith("<")
  );
}

/** Names of tools whose citations appear in this turn — used for corpus labelling. */
function pendingToolsForCorpus(citations: Citation[]): string[] {
  const out = new Set<string>();
  for (const c of citations) {
    if (c.source === "web") out.add("web-search");
  }
  return [...out];
}

/**
 * Adapter: turn the native model's `generateTextStream(prompt)` into the same
 * shape `streamLLM` returns. We collapse the chat history + system prompt into
 * a single prompt string using the chat template the model is trained on.
 *
 * Tool calls aren't supported on this path yet — the native model would need
 * to be trained on the structured-tool protocol first. For now it serves
 * pure text generation; tool-using turns fall back to streamLLM via the
 * orchestrator's hop loop catching pendingTools = [].
 */
function makeNativeInferenceAdapter(): (req: LLMRequest) => AsyncIterable<LLMStreamChunk> {
  return async function* nativeStream(req: LLMRequest) {
    const parts: string[] = [];
    if (req.system) parts.push(`<system>${req.system}</system>`);
    for (const m of req.messages.slice(-12)) {
      if (m.role === "user") parts.push(`<user>${m.content}</user>`);
      else if (m.role === "assistant") parts.push(`<assistant>${m.content}</assistant>`);
      else if (m.role === "tool") parts.push(`<tool-result>${m.content}</tool-result>`);
    }
    parts.push("<assistant>");
    const prompt = parts.join("\n");

    let tokens = 0;
    for await (const piece of generateTextStream(prompt, {
      maxTokens: req.maxTokens ?? 768,
      temperature: req.temperature ?? 0.7,
      topP: 0.95,
      stop: ["</assistant>", "<|endoftext|>"],
      signal: req.signal,
    })) {
      if (piece) {
        tokens++;
        yield { type: "text", text: piece, tokens };
      }
    }
    yield { type: "finish", tokens };
  };
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
    const cross = memoryHits.filter((m) => m.threadId);
    const same = memoryHits.filter((m) => !m.threadId);
    if (cross.length > 0) {
      lines.push("\n## Memories from earlier conversations with this user");
      for (const m of cross.slice(0, 4)) lines.push(`- ${m.text}`);
    }
    if (same.length > 0) {
      lines.push("\n## Memories from this conversation");
      for (const m of same.slice(0, 5)) lines.push(`- ${m.text}`);
    }
  }
  return lines.join("\n");
}
