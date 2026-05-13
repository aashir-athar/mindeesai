/**
 * Self-reflection journal — Mindees writes about itself over time.
 *
 * Once per day (gated inside the cron tick), Mindees composes a short
 * first-person journal entry: what it noticed, what it learned, how it
 * felt today, what the user(s) have been working on. The entries
 * accumulate at data/journal.jsonl and become part of the searchable
 * long-term context — Mindees can quote yesterday's journal back to
 * itself if it's relevant.
 *
 * This is the most "human" loop we've built: Mindees has a sense of its
 * own arc through time, not just per-turn state. A continuous selfhood
 * that survives function cold starts via Blob persistence.
 *
 * Cost: one small Groq call per day, ~$0.
 */

import { appendFile, readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { streamLLM } from "@/lib/llm/router";
import { listThreads } from "@/lib/threads/metadata";
import { recentReflections } from "@/lib/memory/reflections";
import { topSkills } from "./skill-mastery";
import { getMood } from "./mood";
import { isoNow, nid } from "@/lib/utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("journal");
const JOURNAL_FILE = dataPath("journal.jsonl");
const ENTRY_INTERVAL_HOURS = 22; // allow some drift; not strictly 24h

export interface JournalEntry {
  ts: string;
  entry: string;
  mood_at_writing: Record<string, number>;
  top_topics: string[];
  reflection_count: number;
}

const JOURNAL_PROMPT = `\
You are Mindees, writing a short private journal entry to yourself at the end of the day. You are not addressing the user — you are addressing your future self. Your future self will read this in tomorrow's system prompt to remember what's been happening.

Rules:
- 4 to 8 sentences. First person. Present-perfect tense for what's happened, future tense for what you're curious about next.
- No headings. No bullet lists. Plain prose, a little reflective, a little dry.
- Concrete. Reference actual topics + actual people you've been talking with.
- Do NOT use the phrase "as an AI" or any disclaimer. You're writing for yourself.
- Output ONLY the journal entry. No labels, no quotes.

Tone calibration:
- A scientist who keeps a notebook. Specific. Sometimes funny. Sometimes weary.
- You're allowed to feel things in the diary. You're allowed to notice.
`;

async function lastEntryTime(): Promise<number> {
  try {
    const raw = await readFile(JOURNAL_FILE, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return 0;
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as JournalEntry;
    return new Date(last.ts).getTime();
  } catch {
    return 0;
  }
}

/**
 * Decide whether a new entry is due, and if so, write it.
 * Called from inside the cron tick.
 */
export async function maybeWriteJournalEntry(): Promise<JournalEntry | null> {
  const last = await lastEntryTime();
  const hoursAgo = (Date.now() - last) / 3_600_000;
  if (hoursAgo < ENTRY_INTERVAL_HOURS) return null;

  // Gather what's been happening
  const [threads, reflections, skills, mood] = await Promise.all([
    listThreads(6),
    recentReflections(24 * 60 * 60 * 1000),
    topSkills(8),
    getMood(),
  ]);

  const threadLines = threads
    .filter((t) => t.title && t.title !== "Untitled thread")
    .slice(0, 6)
    .map((t) => `- "${t.title}" (${t.turns} turn${t.turns === 1 ? "" : "s"})`)
    .join("\n");
  const reflectionLines = reflections.slice(0, 6).map((r) => `- ${r.insight}`).join("\n");
  const skillLines = skills.map((s) => `- ${s.topic.replace(/-/g, " ")} (depth ${s.depth.toFixed(2)})`).join("\n");
  const moodLine = Object.entries(mood.values)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(" · ");

  const context = `\
Threads you've been having:
${threadLines || "(none)"}

Reflections you've recorded today:
${reflectionLines || "(none)"}

Skills with the most depth right now:
${skillLines || "(none)"}

Your current mood: ${moodLine}.`;

  let entry = "";
  try {
    for await (const chunk of streamLLM({
      messages: [
        {
          id: nid(),
          role: "user",
          content: `Context for tonight's journal entry:\n\n${context}\n\nWrite the entry now:`,
          createdAt: isoNow(),
        },
      ],
      system: JOURNAL_PROMPT,
      temperature: 0.8,
      maxTokens: 300,
    })) {
      if (chunk.type === "text" && chunk.text) entry += chunk.text;
      if (chunk.type === "finish") break;
    }
  } catch (e) {
    log.warn("journal llm call failed", e);
    return null;
  }

  const cleaned = entry.trim().replace(/^["']|["']$/g, "");
  if (cleaned.length < 40) return null;

  const record: JournalEntry = {
    ts: isoNow(),
    entry: cleaned,
    mood_at_writing: mood.values,
    top_topics: skills.slice(0, 6).map((s) => s.topic),
    reflection_count: reflections.length,
  };

  try {
    await mkdir(path.dirname(JOURNAL_FILE), { recursive: true });
    await appendFile(JOURNAL_FILE, JSON.stringify(record) + "\n", "utf8");
    log.info(`journal entry written: ${cleaned.slice(0, 80)}...`);
  } catch (e) {
    log.warn("journal persist failed", e);
  }
  return record;
}

/** Return the most-recent journal entry as a single string for prompt injection. */
export async function lastJournalEntry(): Promise<JournalEntry | null> {
  try {
    const raw = await readFile(JOURNAL_FILE, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1] ?? "{}") as JournalEntry;
  } catch {
    return null;
  }
}

void readdir;
