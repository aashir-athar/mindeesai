/**
 * Rolling thread summary — auto-condenses long conversations.
 *
 * Without this, long threads either (a) blow the context window or (b) lose
 * detail past the orchestrator's last-12-turn slice. With this, every 6
 * turns we generate a short editorial summary of what's been discussed
 * and persist it per-thread. The orchestrator injects this summary into
 * the system prompt BEFORE the last few raw turns — so Mindees keeps the
 * full arc of a long conversation indefinitely at constant context cost.
 *
 * Free: one small Groq call every 6 turns. Cached afterwards.
 *
 * Persisted at: data/thread-summaries/<threadId>.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { streamLLM } from "@/lib/llm/router";
import { readThread } from "@/lib/memory/conversations";
import { isoNow, nid } from "@/lib/utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("thread-summary");

const DIR = dataPath("thread-summaries");
const SUMMARIZE_EVERY = 6;
const RECENT_TURNS_VERBATIM = 12;

export interface ThreadSummary {
  threadId: string;
  summary: string;
  upThroughTurn: number;
  updatedAt: string;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

export async function getSummary(threadId: string): Promise<ThreadSummary | null> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return JSON.parse(raw) as ThreadSummary;
  } catch {
    return null;
  }
}

async function persist(s: ThreadSummary): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(s.threadId), JSON.stringify(s, null, 2), "utf8");
  } catch (e) {
    log.warn("summary persist failed", e);
  }
}

const SUMMARY_PROMPT = `\
You compress a chat conversation into a short editorial summary that the assistant can read on every future turn to keep the full arc in mind. The summary replaces nothing — it's read alongside the last few raw turns — so its job is to surface the long-running threads, not the most recent details.

Rules:
- 3 to 6 sentences. Plain prose.
- Cover: what the user is working on, decisions made, things they care about, important constraints, recurring themes.
- Skip filler ("good morning", acknowledgements, single-word turns).
- Do NOT re-quote the last exchange — that's redundant with the recent-turns context.
- Use second person about the user ("you've been debugging…", "you prefer…").
- No bullet lists. No headings. Just prose.
- Output ONLY the summary text. No labels, no quotes.
`;

/**
 * Decide whether to refresh the summary, and if so, do it.
 * Called fire-and-forget from the orchestrator after each turn.
 */
export async function maybeUpdateSummary(opts: {
  threadId: string;
  currentTurnCount: number;
  signal?: AbortSignal;
}): Promise<ThreadSummary | null> {
  // Only run when the thread is long enough to benefit
  if (opts.currentTurnCount < SUMMARIZE_EVERY * 2) return null;

  const existing = await getSummary(opts.threadId);
  const lastSummarisedAt = existing?.upThroughTurn ?? 0;
  if (opts.currentTurnCount - lastSummarisedAt < SUMMARIZE_EVERY) {
    return existing;
  }

  const turns = await readThread(opts.threadId);
  // Exclude the verbatim-recent turns — they're in the prompt anyway.
  const olderTurns = turns.slice(0, Math.max(0, turns.length - RECENT_TURNS_VERBATIM));
  if (olderTurns.length < 4) return existing;

  const transcript = olderTurns
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`)
    .join("\n");

  let buf = "";
  try {
    for await (const chunk of streamLLM({
      messages: [
        {
          id: nid(),
          role: "user",
          content: `Conversation so far (older turns only — the recent ones are still in the assistant's context):\n\n${transcript}\n\nWrite the summary now:`,
          createdAt: isoNow(),
        },
      ],
      system: SUMMARY_PROMPT,
      temperature: 0.2,
      maxTokens: 280,
      signal: opts.signal,
    })) {
      if (chunk.type === "text" && chunk.text) buf += chunk.text;
      if (chunk.type === "finish") break;
    }
  } catch (e) {
    log.warn("summary llm call failed", e);
    return existing;
  }

  const cleaned = buf.trim().replace(/^["'`]|["'`]$/g, "");
  if (cleaned.length < 20) return existing;

  const updated: ThreadSummary = {
    threadId: opts.threadId,
    summary: cleaned,
    upThroughTurn: opts.currentTurnCount,
    updatedAt: new Date().toISOString(),
  };
  await persist(updated);
  log.info(`summary refreshed for thread ${opts.threadId} @ turn ${opts.currentTurnCount}`);
  return updated;
}
