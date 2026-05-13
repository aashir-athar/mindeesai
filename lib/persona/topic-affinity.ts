/**
 * Topic-affinity tensor — which topics light THIS user up.
 *
 * Humans remember what their friends love talking about. If you bring up
 * music with a music-lover, they perk up; bring up tax law with the same
 * person and you watch them disengage. Mindees needs the same instinct.
 *
 * Per-user (not per-thread) — affinity is a property of the relationship,
 * not the conversation.
 *
 * Signal sources, all derived from existing tensors at zero LLM cost:
 *   - Reply length expanded after a topic was introduced     → engagement
 *   - Mood warmth/curiosity rose after a topic                → engagement
 *   - Follow-up question rate increased after a topic         → engagement
 *   - Reply length collapsed after a topic was introduced    → dropoff
 *   - Mood frustration rose after a topic                    → dropoff
 *
 * We track an EMA per topic. Narrative is a single line:
 *   "This user loves talking about: ..."
 *   "...and tends to disengage on: ..."
 *
 * Used at prompt time to (1) avoid surprising the user with a deep-dive
 * on a topic they don't care about, and (2) gently steer toward topics
 * that energise them when the conversation is open.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("topic-affinity.json");
const MAX_TOPICS = 80;
const ALPHA = 0.25;

export interface TopicAffinity {
  topic: string;
  affinity: number; // -1..+1
  samples: number;
  lastSeen: string;
}

export interface AffinityFile {
  topics: Record<string, TopicAffinity>;
  updatedAt: string;
}

let cache: AffinityFile | null = null;

async function load(): Promise<AffinityFile> {
  if (cache) return cache;
  try {
    const raw = await readFile(FILE, "utf8");
    cache = JSON.parse(raw) as AffinityFile;
  } catch {
    cache = { topics: {}, updatedAt: new Date().toISOString() };
  }
  return cache;
}

async function persist(f: AffinityFile): Promise<void> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(f, null, 2), "utf8");
    cache = f;
  } catch { /* ignore */ }
}

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "been",
  "what", "when", "where", "which", "while", "would", "could", "should",
  "your", "their", "them", "they", "into", "about", "after", "before",
  "make", "made", "want", "need", "know", "think", "feel", "good", "bad",
]);

/**
 * Extract topic candidates from a stretch of text. Returns lowercased,
 * stop-word-filtered noun-phrase-ish tokens.
 */
function topicsFrom(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  // Capitalised multi-word terms (typically named entities + proper topics)
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+){0,2})\b/g)) {
    if (m[1]) out.add(m[1].toLowerCase());
  }
  // Standalone content words ≥6 chars (heuristic for "topic" vs "function word")
  for (const m of lower.matchAll(/\b([a-z][a-z]{5,})\b/g)) {
    if (m[1] && !STOPWORDS.has(m[1])) out.add(m[1]);
  }
  return Array.from(out).slice(0, 8);
}

/**
 * Update affinity for the topics introduced in `userText` based on the
 * `engagementSignal` (typically derived from the next-turn behaviour:
 * +1 = user wrote a long enthusiastic follow-up; -1 = dropped off).
 */
export async function bumpAffinity(userText: string, engagementSignal: number): Promise<void> {
  const f = await load();
  const topics = topicsFrom(userText);
  const now = new Date().toISOString();
  for (const t of topics) {
    const prev = f.topics[t] ?? { topic: t, affinity: 0, samples: 0, lastSeen: now };
    prev.affinity = clamp(prev.affinity + ALPHA * (engagementSignal - prev.affinity), -1, 1);
    prev.samples += 1;
    prev.lastSeen = now;
    f.topics[t] = prev;
  }
  // Prune to MAX_TOPICS — keep the highest |affinity| ones
  const keys = Object.keys(f.topics);
  if (keys.length > MAX_TOPICS) {
    const ranked = Object.values(f.topics)
      .sort((a, b) => Math.abs(b.affinity) * b.samples - Math.abs(a.affinity) * a.samples)
      .slice(0, MAX_TOPICS);
    f.topics = Object.fromEntries(ranked.map((r) => [r.topic, r]));
  }
  f.updatedAt = now;
  await persist(f);
}

/**
 * Derive an engagement signal from this turn. Compares reply length /
 * affect to a rolling baseline. Designed to be cheap — pure heuristics.
 */
export function engagementFromTurn(opts: {
  userMessageLen: number;
  avgUserLen: number;
  curiosityCues: number; // 0..1
  frustrationCues: number; // 0..1
  warmthCues: number; // 0..1
}): number {
  const lenRatio = opts.userMessageLen / Math.max(40, opts.avgUserLen);
  let score = 0;
  if (lenRatio > 1.4) score += 0.5;       // user wrote MORE than usual
  if (lenRatio < 0.4) score -= 0.4;       // user wrote LESS than usual
  score += 0.6 * opts.curiosityCues;
  score += 0.6 * opts.warmthCues;
  score -= 0.8 * opts.frustrationCues;
  return clamp(score, -1, 1);
}

export async function readAffinities(): Promise<TopicAffinity[]> {
  const f = await load();
  return Object.values(f.topics)
    .filter((t) => t.samples >= 2)
    .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity));
}

export function affinityNarrative(affinities: TopicAffinity[]): string {
  if (affinities.length === 0) return "";
  const loves = affinities.filter((a) => a.affinity > 0.30).slice(0, 8).map((a) => a.topic);
  const avoids = affinities.filter((a) => a.affinity < -0.30).slice(0, 6).map((a) => a.topic);
  const parts: string[] = [];
  if (loves.length) parts.push(`This user lights up on these topics: ${loves.join(", ")}. When the conversation is open-ended, you can gently steer toward one of these.`);
  if (avoids.length) parts.push(`They tend to disengage on these topics: ${avoids.join(", ")}. Don't dwell there unless they bring it up.`);
  return parts.join(" ");
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
