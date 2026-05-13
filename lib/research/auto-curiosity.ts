/**
 * Auto-curiosity — pick the topics Mindees is most uncertain about right
 * now, so the cron tick can go research them in the background.
 *
 * Signal sources:
 *   - **theory-of-mind beliefs** of every active thread: anything the user
 *     showed they DON'T know is also something Mindees should make sure it
 *     can explain. Anything marked UNCERTAIN is fertile territory too.
 *   - **recent corrections**: every time the user corrected Mindees, that
 *     topic is a confirmed knowledge gap.
 *   - **recent hedges** in assistant replies (drift fingerprint history)
 *     — high hedge density implies Mindees was guessing.
 *
 * Output: a deduped list of topics, ranked by priority. The cron tick will
 * research each, persist the passages as recallable memories, and log the
 * activity to data/auto-research-log.jsonl so the /research page can show
 * what Mindees has been studying.
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { recentThreads } from "@/lib/memory/conversations";
import { readBeliefs } from "@/lib/persona/theory-of-mind";
import { recentCorrections } from "@/lib/persona/self-correction";
import { createLogger } from "@/lib/logger";

const log = createLogger("auto-curiosity");
const LOG_FILE = dataPath("auto-research-log.jsonl");

export interface CuriosityTopic {
  topic: string;
  priority: number; // higher = research first
  reason: "correction" | "user-didnt-know" | "user-uncertain";
  sourceThreadId?: string;
}

export async function pickCuriosityTopics(limit = 5): Promise<CuriosityTopic[]> {
  const out = new Map<string, CuriosityTopic>();

  // 1. Corrections — strongest signal (3 priority units each)
  try {
    const corrections = await recentCorrections(20);
    for (const c of corrections) {
      const topics = extractTopics(c.user_correction);
      for (const t of topics) {
        bump(out, t, 3, "correction", c.threadId);
      }
    }
  } catch (e) {
    log.warn("corrections read failed", e);
  }

  // 2. Per-thread theory-of-mind beliefs — pick the LOW/uncertain ones (1-2 priority each)
  try {
    const threads = await recentThreads(7 * 24 * 60 * 60 * 1000); // last week
    for (const t of threads.slice(0, 12)) {
      const beliefs = await readBeliefs(t.threadId).catch(() => []);
      for (const b of beliefs) {
        if (b.level === "low") bump(out, b.topic, 2, "user-didnt-know", t.threadId);
        else if (b.level === "uncertain") bump(out, b.topic, 1, "user-uncertain", t.threadId);
      }
    }
  } catch (e) {
    log.warn("beliefs sweep failed", e);
  }

  const ranked = Array.from(out.values())
    .filter((c) => c.topic.length >= 3 && c.topic.length <= 60)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);

  return ranked;
}

function bump(
  out: Map<string, CuriosityTopic>,
  rawTopic: string,
  priority: number,
  reason: CuriosityTopic["reason"],
  sourceThreadId?: string,
): void {
  const topic = rawTopic.trim().toLowerCase();
  if (!topic || topic.length < 3) return;
  const existing = out.get(topic);
  if (existing) {
    existing.priority += priority;
  } else {
    out.set(topic, { topic, priority, reason, sourceThreadId });
  }
}

/**
 * Pull noun-phrase candidates out of a free-text user message. Cheap regex
 * extractor — not a parser. We're looking for the things people get
 * corrected about: technical terms, names, capitalised phrases.
 */
function extractTopics(text: string): string[] {
  const out = new Set<string>();
  // Quoted phrases
  for (const m of text.matchAll(/"([^"]{3,60})"/g)) {
    if (m[1]) out.add(m[1]);
  }
  // Capitalised multi-word terms
  for (const m of text.matchAll(/\b([A-Z][a-z0-9]{2,}(?:\s+[A-Z][a-z0-9]+){0,3})\b/g)) {
    if (m[1] && m[1].split(" ").length <= 4) out.add(m[1]);
  }
  // "X is Y" → take X and Y as candidates (often the correction structure)
  for (const m of text.matchAll(/\b(?:it'?s|its|actually|no,?)\s+([a-z][a-zA-Z0-9 .+#-]{2,40})\b/gi)) {
    if (m[1]) out.add(m[1]);
  }
  return Array.from(out);
}

export interface AutoResearchLogEntry {
  ts: string;
  topic: string;
  reason: CuriosityTopic["reason"];
  hits: number;
  passages: number;
  ok: boolean;
}

export async function logAutoResearch(entry: AutoResearchLogEntry): Promise<void> {
  try {
    await mkdir(path.dirname(LOG_FILE), { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    log.warn("auto-research log append failed", e);
  }
}

export async function readAutoResearchLog(limit = 50): Promise<AutoResearchLogEntry[]> {
  try {
    const raw = await readFile(LOG_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const parsed: AutoResearchLogEntry[] = [];
    for (const l of lines.slice(-limit * 2)) {
      try { parsed.push(JSON.parse(l) as AutoResearchLogEntry); } catch { /* skip */ }
    }
    return parsed.slice(-limit).reverse();
  } catch {
    return [];
  }
}
