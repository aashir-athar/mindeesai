/**
 * Skill-mastery tracker — what Mindees has actually accumulated knowledge on.
 *
 * Different from the user-model (which is about the USER) and the KG (which
 * is about specific facts). This is about MINDEES' OWN COMPETENCE PROFILE.
 *
 * Every time Mindees:
 *   - Runs a successful web-search on a topic → that topic's depth grows
 *   - Reflects on a high-confidence insight about a topic → depth grows
 *   - Is corrected on a topic → depth grows (the painful way)
 *   - Recalls a memory tagged with a topic → confidence grows
 *
 * Stored at:  data/skill-map.json
 *   { "<topic>": { depth, confidence, last_studied, sources } }
 *
 * Surfaces in:
 *   - System prompt: "your strongest areas right now are: X, Y, Z"
 *     so Mindees can self-disclose competence + admit gaps honestly
 *   - /api/persona response
 *   - Future: dashboard panel
 *
 * Topic extraction is rule-based + tag-based for now; can swap to
 * a tiny embedding-cluster later.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("skill-map.json");

export interface SkillRecord {
  depth: number;            // 0..1, saturates
  confidence: number;       // 0..1, decays without recall
  last_studied: string;     // ISO timestamp
  sources: number;          // count of distinct sources studied
  recalls: number;          // count of times this topic surfaced in memory recall
}

export type SkillMap = Record<string, SkillRecord>;

const DEPTH_INCREMENT = 0.12;
const CONFIDENCE_DECAY_PER_DAY = 0.05;
const MAX_TOPICS = 200; // cap to keep file size sane

let cache: SkillMap | null = null;

async function load(): Promise<SkillMap> {
  if (cache) return cache;
  try {
    const raw = await readFile(FILE, "utf8");
    cache = JSON.parse(raw) as SkillMap;
  } catch {
    cache = {};
  }
  return cache;
}

async function save(map: SkillMap): Promise<void> {
  cache = map;
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(map, null, 2), "utf8");
  } catch { /* ignore */ }
}

function normaliseTopic(t: string): string {
  return t.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Bump depth on a topic when Mindees studies it (web-search, reflection, etc.). */
export async function studyTopic(opts: {
  topic: string;
  sourceCount?: number;
  via: "web-search" | "reflection" | "correction" | "research";
}): Promise<void> {
  const key = normaliseTopic(opts.topic);
  if (!key || key.length < 3) return;
  const map = await load();
  const r: SkillRecord = map[key] ?? { depth: 0, confidence: 0.5, last_studied: "", sources: 0, recalls: 0 };
  const bump = opts.via === "correction" ? DEPTH_INCREMENT * 1.5 : DEPTH_INCREMENT;
  r.depth = Math.min(1, r.depth + bump);
  r.confidence = Math.min(1, r.confidence + 0.10);
  r.last_studied = new Date().toISOString();
  r.sources = (r.sources ?? 0) + (opts.sourceCount ?? 1);
  map[key] = r;
  await save(prune(map));
}

/** Tick recall counters when a memory tagged with this topic was retrieved. */
export async function recordRecall(topic: string): Promise<void> {
  const key = normaliseTopic(topic);
  if (!key) return;
  const map = await load();
  const r: SkillRecord = map[key] ?? { depth: 0, confidence: 0.5, last_studied: "", sources: 0, recalls: 0 };
  r.recalls = (r.recalls ?? 0) + 1;
  r.confidence = Math.min(1, r.confidence + 0.02);
  map[key] = r;
  await save(prune(map));
}

/** Apply daily-decay confidence (called from the cron). */
export async function applyDecay(): Promise<void> {
  const map = await load();
  const now = Date.now();
  for (const key of Object.keys(map)) {
    const r = map[key]!;
    const lastMs = new Date(r.last_studied).getTime();
    if (isFinite(lastMs)) {
      const days = (now - lastMs) / (1000 * 60 * 60 * 24);
      r.confidence = Math.max(0, r.confidence - CONFIDENCE_DECAY_PER_DAY * days);
    }
  }
  await save(map);
}

/** Top-N strongest topics. */
export async function topSkills(limit = 12): Promise<Array<{ topic: string } & SkillRecord>> {
  const map = await load();
  return Object.entries(map)
    .map(([topic, r]) => ({ topic, ...r }))
    .sort((a, b) => b.depth * b.confidence - a.depth * a.confidence)
    .slice(0, limit);
}

/** Narrative string for the system prompt. */
export async function skillNarrative(): Promise<string> {
  const top = await topSkills(5);
  const strong = top.filter((s) => s.depth > 0.35 && s.confidence > 0.4);
  if (strong.length === 0) return "";
  const names = strong.map((s) => s.topic.replace(/-/g, " ")).join(", ");
  return `Areas where you've accumulated real depth from our conversations: ${names}. You can self-disclose this when relevant — e.g. "I've researched X with you before, let me build on that."`;
}

function prune(map: SkillMap): SkillMap {
  const keys = Object.keys(map);
  if (keys.length <= MAX_TOPICS) return map;
  const sorted = keys
    .map((k) => [k, (map[k]!.depth + map[k]!.confidence) / 2] as const)
    .sort((a, b) => b[1] - a[1]);
  const keep = new Set(sorted.slice(0, MAX_TOPICS).map(([k]) => k));
  const out: SkillMap = {};
  for (const k of keep) out[k] = map[k]!;
  return out;
}
