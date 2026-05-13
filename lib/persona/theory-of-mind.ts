/**
 * Theory-of-mind tensor — what Mindees believes the user believes.
 *
 * Humans constantly model their conversation partner's mental state:
 * "they already know X so I don't need to explain it", "they seemed unsure
 * about Y last time so let me check before assuming". Mindees needs this
 * too. Without it, replies skew toward over-explaining (lecturing experts)
 * or under-explaining (assuming knowledge that isn't there).
 *
 * Implementation: per-thread map { topic → ConfidenceLevel } populated by
 * scanning user messages for confidence/uncertainty markers.
 *
 *   "I know how transformers work"           → topic="transformers", high
 *   "what's a closure?"                      → topic="closure", low
 *   "I think reduce maps a list..."          → topic="reduce", medium-uncertain
 *   "I'm a Rust dev"                         → topic="rust", high
 *
 * Cheap, deterministic, per-thread. The narrative tells Mindees:
 *   "user shown high familiarity with: rust, transformers"
 *   "user shown low familiarity with: closure"
 *
 * No paid services, no model calls — pure regex + a tiny noun extractor.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const DIR = dataPath("theory-of-mind");

export type ConfidenceLevel = "low" | "uncertain" | "medium" | "high";

export interface TopicBelief {
  topic: string;
  level: ConfidenceLevel;
  lastUpdated: string;
  evidence: string; // verbatim snippet that earned this belief
}

export interface TheoryOfMindFile {
  threadId: string;
  beliefs: Record<string, TopicBelief>; // keyed by lowercased topic
  updatedAt: string;
}

// Phrases that signal HIGH confidence — "I know X", "I've built X", etc.
const HIGH_PATTERNS: RegExp[] = [
  /\b(?:i (?:already )?know|i'?m familiar with|i'?ve (?:built|used|worked with|written|shipped)|i can|i do|i write|i build)\s+(?:about |with |in )?([a-z][a-z0-9 .+#-]{1,40})/i,
  /\bi'?m (?:a |an )?([a-z][a-z0-9 -]{2,30}?) (?:dev|developer|engineer|expert|architect|fan|user)\b/i,
  /\bbeen (?:using|writing|building (?:with|in)) ([a-z][a-z0-9 .+#-]{1,30}) (?:for|since)\b/i,
];

// Phrases that signal LOW confidence — "what is X", "how does X work"
const LOW_PATTERNS: RegExp[] = [
  /\bwhat(?:'?s| is)\s+(?:a |an |the )?([a-z][a-z0-9 .+#-]{1,30})\??/i,
  /\bhow does\s+(?:a |an |the )?([a-z][a-z0-9 .+#-]{1,30})\s+work\b/i,
  /\bi (?:don'?t|do not) (?:really )?(?:understand|get|know (?:what|how))\s+(?:a |an |the )?([a-z][a-z0-9 .+#-]{1,30})/i,
  /\bnew to\s+([a-z][a-z0-9 .+#-]{1,30})\b/i,
  /\bnever (?:used|tried|seen|written|heard of)\s+([a-z][a-z0-9 .+#-]{1,30})\b/i,
];

// Phrases that signal UNCERTAIN — "I think X", "is it X?"
const UNCERTAIN_PATTERNS: RegExp[] = [
  /\bi think\s+([a-z][a-z0-9 .+#-]{2,30})\s+(?:is|does|works|means)/i,
  /\bisn'?t ([a-z][a-z0-9 .+#-]{2,30}) (?:the|a|an)\b/i,
];

const STOP_TOPIC = new Set([
  "a", "an", "the", "this", "that", "it", "thing", "stuff", "way",
  "way to", "way of", "i", "you", "we", "they", "me", "us", "them",
  "yes", "no", "okay", "ok", "good", "bad", "what", "how", "why",
  "where", "when", "who",
]);

function normalizeTopic(raw: string): string | null {
  let t = raw.trim().toLowerCase();
  // Strip leading articles/possessives that snuck in
  t = t.replace(/^(?:a |an |the |my |your |our |this |that |these |those )/i, "");
  // Strip trailing punctuation/whitespace
  t = t.replace(/[.,;:!?]+$/g, "").trim();
  if (t.length < 2 || t.length > 40) return null;
  if (STOP_TOPIC.has(t)) return null;
  // Reject single common verbs/conjunctions
  if (/^(?:is|are|was|were|be|been|do|did|done|go|going|gone)$/.test(t)) return null;
  return t;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

async function load(threadId: string): Promise<TheoryOfMindFile> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return JSON.parse(raw) as TheoryOfMindFile;
  } catch {
    return { threadId, beliefs: {}, updatedAt: new Date().toISOString() };
  }
}

async function persist(t: TheoryOfMindFile): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(t.threadId), JSON.stringify(t), "utf8");
  } catch { /* ignore */ }
}

// Confidence ordering — when we have conflicting signals we keep the most
// recent unless the older one was strictly more specific.
const RANK: Record<ConfidenceLevel, number> = { low: 0, uncertain: 1, medium: 2, high: 3 };

function addBelief(
  store: TheoryOfMindFile,
  topic: string,
  level: ConfidenceLevel,
  evidence: string,
): void {
  const norm = normalizeTopic(topic);
  if (!norm) return;
  const prior = store.beliefs[norm];
  // Always store the LATEST level — user's knowledge may have grown.
  // But if a high-confidence belief exists and a new uncertain one comes
  // in, treat that as a regression we should be skeptical of (keep high).
  if (prior && RANK[prior.level] > RANK[level] && level !== "low") {
    return;
  }
  store.beliefs[norm] = {
    topic: norm,
    level,
    lastUpdated: new Date().toISOString(),
    evidence: evidence.slice(0, 140),
  };
}

export async function updateFromUserMessage(
  threadId: string,
  text: string,
): Promise<void> {
  const store = await load(threadId);
  let changed = false;

  for (const re of HIGH_PATTERNS) {
    const m = re.exec(text);
    if (m && m[1]) {
      addBelief(store, m[1], "high", text);
      changed = true;
    }
  }
  for (const re of LOW_PATTERNS) {
    const m = re.exec(text);
    if (m && m[1]) {
      addBelief(store, m[1], "low", text);
      changed = true;
    }
  }
  for (const re of UNCERTAIN_PATTERNS) {
    const m = re.exec(text);
    if (m && m[1]) {
      addBelief(store, m[1], "uncertain", text);
      changed = true;
    }
  }

  if (changed) {
    store.updatedAt = new Date().toISOString();
    await persist(store);
  }
}

export async function readBeliefs(threadId: string): Promise<TopicBelief[]> {
  const t = await load(threadId);
  return Object.values(t.beliefs).sort(
    (a, b) => (b.lastUpdated < a.lastUpdated ? -1 : 1),
  );
}

export function theoryOfMindNarrative(beliefs: TopicBelief[]): string {
  if (beliefs.length === 0) return "";
  const high = beliefs.filter((b) => b.level === "high").slice(0, 6).map((b) => b.topic);
  const low = beliefs.filter((b) => b.level === "low").slice(0, 6).map((b) => b.topic);
  const uncertain = beliefs.filter((b) => b.level === "uncertain").slice(0, 4).map((b) => b.topic);
  const parts: string[] = [];
  if (high.length) parts.push(`Things this user has demonstrated they ALREADY know — don't explain these from scratch: ${high.join(", ")}.`);
  if (low.length) parts.push(`Things they've signalled they DON'T know yet — explain these clearly without condescension: ${low.join(", ")}.`);
  if (uncertain.length) parts.push(`Things they seemed UNCERTAIN about (probably half-knowledge) — confirm the gist before correcting any details: ${uncertain.join(", ")}.`);
  return parts.join(" ");
}
