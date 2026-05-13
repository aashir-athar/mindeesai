/**
 * Goal tensor — the working orientation of the conversation.
 *
 * Not a vector this time: a short string describing what the user is currently
 * trying to accomplish. Updated each turn by a tiny LLM call that looks at the
 * recent exchange and either revises the existing goal or carries it forward.
 *
 * Why this matters: Mindees can be brilliant turn-by-turn and still lose the
 * thread of what we're working toward. The goal tensor is a single sentence
 * the system prompt carries on every turn — "we are debugging a Vercel cron
 * timeout", "we are writing a launch post" — so every reply reorients to it.
 *
 * Persisted per-thread:  data/goals/<threadId>.json
 *   {
 *     goal:         current one-sentence goal
 *     evidence:     verbatim snippet that informed it
 *     confidence:   0..1 — low confidence after only one turn, grows
 *     history:      last 6 goal strings (lets us detect goal-thrash)
 *     updatedAt
 *   }
 *
 * Cost: one small Groq call per turn (~200ms, free).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { streamLLM } from "@/lib/llm/router";
import { isoNow, nid } from "@/lib/utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("goal-tensor");

const DIR = dataPath("goals");

export interface GoalState {
  threadId: string;
  goal: string;
  evidence: string;
  confidence: number;
  history: string[];
  updatedAt: string;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

export async function getGoal(threadId: string): Promise<GoalState> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    const parsed = JSON.parse(raw) as GoalState;
    if (parsed?.goal) return parsed;
  } catch { /* fresh */ }
  return {
    threadId,
    goal: "unset — first turn",
    evidence: "",
    confidence: 0,
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

const GOAL_PROMPT = `\
You read the latest exchange between a user and an assistant, and you output a SINGLE SENTENCE describing what the user is currently trying to accomplish in this thread.

Rules:
- One sentence. Less than 16 words.
- Present tense. Concrete subject.
- If the goal is unchanged from the prior turn, output exactly the prior goal verbatim.
- If you can't tell yet, output: "exploring — not yet clear"
- Output ONLY the sentence. No quotes, no labels, no explanation.

Examples:
  PRIOR: "Debugging a Vercel cron 60s timeout in /api/cron/self-improve"
  TURN: "tried allowOverwrite=true but the flush still skips files"
  GOAL: Debugging the Vercel cron 60s timeout in /api/cron/self-improve

  PRIOR: "exploring — not yet clear"
  TURN: "I'm thinking of building a self-training open-source AI"
  GOAL: Building a self-training open-source AI
`;

export async function updateGoal(opts: {
  threadId: string;
  recentUserMessage: string;
  recentAssistantReply: string;
  signal?: AbortSignal;
}): Promise<GoalState> {
  const current = await getGoal(opts.threadId);

  let inferred = "";
  try {
    for await (const chunk of streamLLM({
      messages: [
        {
          id: nid(),
          role: "user",
          content: `PRIOR: ${current.goal}\n\nTURN — USER:\n${opts.recentUserMessage.slice(0, 400)}\n\nTURN — ASSISTANT:\n${opts.recentAssistantReply.slice(0, 400)}\n\nGOAL:`,
          createdAt: isoNow(),
        },
      ],
      system: GOAL_PROMPT,
      temperature: 0.2,
      maxTokens: 40,
      signal: opts.signal,
    })) {
      if (chunk.type === "text" && chunk.text) inferred += chunk.text;
      if (chunk.type === "finish") break;
    }
  } catch (e) {
    log.warn("goal inference failed", e);
    return current;
  }

  const cleaned = (inferred.trim().split("\n")[0] ?? "").trim().replace(/^["']|["']$/g, "");
  if (!cleaned || cleaned.length > 200) return current;

  const changed = cleaned !== current.goal;
  const updated: GoalState = {
    threadId: opts.threadId,
    goal: cleaned,
    evidence: opts.recentUserMessage.slice(0, 200),
    confidence: changed ? Math.max(0.4, current.confidence * 0.7) : Math.min(1, current.confidence + 0.15),
    history: changed ? [current.goal, ...current.history].slice(0, 6) : current.history,
    updatedAt: new Date().toISOString(),
  };

  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(opts.threadId), JSON.stringify(updated, null, 2), "utf8");
  } catch (e) {
    log.warn("goal persist failed", e);
  }
  return updated;
}

export function goalNarrative(g: GoalState): string {
  if (!g.goal || g.goal === "unset — first turn" || g.goal === "exploring — not yet clear") return "";
  const stability = g.confidence > 0.6 ? "established" : g.confidence > 0.3 ? "tentative" : "newly noticed";
  return `What the user is working toward right now: "${g.goal}". (${stability})`;
}
