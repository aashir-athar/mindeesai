/**
 * Sleep-cycle consolidation — daily episodic → semantic abstraction.
 *
 * Humans don't just store every event verbatim. During sleep, the brain
 * abstracts patterns: "the kids brought me a flower on Tuesday" + "the
 * kids hugged me on Wednesday" + "the kids made me a card on Thursday"
 * → "the kids have been especially affectionate this week".
 *
 * Mindees needed the same thing. Reflections accumulate, delights pile
 * up, corrections come in — but none of it was being LIFTED into
 * higher-order, searchable insights. This module does that, once per
 * ~22 hours, inside the cron tick.
 *
 * What we do (zero LLM cost — pure aggregation):
 *   1. Read the last 24h of reflections, delights, corrections, and
 *      topic-affinity bumps.
 *   2. Count topic mentions across ALL sources (a topic that appears
 *      in a reflection AND a delight is doubly weighted).
 *   3. Topics with ≥3 cross-source mentions become "consolidated
 *      themes" and are written as high-weight insights to LanceDB,
 *      so they surface in every future system prompt's
 *      "Distilled insights" section.
 *
 * Gated to one run per ~22h so it doesn't spam the insights table.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { promoteInsights } from "./lancedb";
import { recentReflections } from "./reflections";
import { recentCorrections } from "@/lib/persona/self-correction";
import { readAffinities } from "@/lib/persona/topic-affinity";
import { createLogger } from "@/lib/logger";
import { isoNow, nid } from "@/lib/utils";

const log = createLogger("sleep-cycle");
const STATE_FILE = dataPath("sleep-cycle.json");
const CYCLE_INTERVAL_HOURS = 22;
const MENTION_THRESHOLD = 3;

interface SleepState {
  lastRanAt: string;
  totalThemes: number;
}

interface DelightLite {
  ts: string;
  mindeesSaid: string;
  userResponse: string;
}

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "been",
  "what", "when", "where", "which", "while", "would", "could", "should",
  "your", "their", "them", "they", "into", "about", "after", "before",
  "make", "made", "want", "need", "know", "think", "feel", "good", "bad",
  "just", "really", "very", "much", "more", "less", "some", "such",
  "also", "even", "still", "yeah", "okay", "sure", "right", "going",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 5 && !STOP.has(t));
}

async function readState(): Promise<SleepState | null> {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")) as SleepState; }
  catch { return null; }
}

async function writeState(s: SleepState): Promise<void> {
  try {
    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
  } catch { /* ignore */ }
}

async function readDelights(): Promise<DelightLite[]> {
  try {
    const raw = await readFile(dataPath("delights.jsonl"), "utf8");
    return raw.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as DelightLite; } catch { return null; }
    }).filter((d): d is DelightLite => !!d);
  } catch { return []; }
}

export interface SleepCycleReport {
  ran: boolean;
  reason?: string;
  themesPromoted: number;
  topicsExamined: number;
}

/**
 * Run one sleep-cycle pass if interval elapsed. Always safe to call.
 */
export async function maybeRunSleepCycle(): Promise<SleepCycleReport> {
  const state = await readState();
  const now = Date.now();
  const lastMs = state ? new Date(state.lastRanAt).getTime() : 0;
  const hoursSince = (now - lastMs) / 3_600_000;
  if (hoursSince < CYCLE_INTERVAL_HOURS) {
    return { ran: false, reason: `${hoursSince.toFixed(1)}h since last; need ${CYCLE_INTERVAL_HOURS}h`, themesPromoted: 0, topicsExamined: 0 };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const [reflections, corrections, delights, affinities] = await Promise.all([
    recentReflections(dayMs).catch(() => []),
    recentCorrections(40).catch(() => []),
    readDelights().catch(() => []),
    readAffinities().catch(() => []),
  ]);

  // Count topic mentions across ALL sources (multiplier per source)
  const counter = new Map<string, { mentions: number; sources: Set<string> }>();
  const bump = (text: string, source: string, weight = 1) => {
    for (const t of tokens(text)) {
      const cur = counter.get(t) ?? { mentions: 0, sources: new Set() };
      cur.mentions += weight;
      cur.sources.add(source);
      counter.set(t, cur);
    }
  };

  for (const r of reflections) bump(r.insight, "reflection", 1);
  for (const c of corrections) bump(c.user_correction, "correction", 2);
  for (const d of delights) {
    bump(d.userResponse, "delight", 2);
    bump(d.mindeesSaid, "delight", 1);
  }
  for (const a of affinities.slice(0, 20)) {
    // High-positive affinity topics get a soft boost
    if (a.affinity > 0.4) bump(a.topic, "affinity", 1);
  }

  // Topics that cross the threshold AND appear in ≥2 distinct sources
  const themes = Array.from(counter.entries())
    .filter(([, v]) => v.mentions >= MENTION_THRESHOLD && v.sources.size >= 2)
    .sort((a, b) => b[1].mentions - a[1].mentions)
    .slice(0, 6);

  if (themes.length === 0) {
    log.info("sleep-cycle: no consolidated themes today (skipping promotion)");
    await writeState({ lastRanAt: isoNow(), totalThemes: state?.totalThemes ?? 0 });
    return { ran: true, themesPromoted: 0, topicsExamined: counter.size };
  }

  const promoted = themes.map(([topic, v]) => ({
    id: nid(),
    text: `Pattern that keeps coming up across this user's conversations: "${topic}" (${v.mentions} mentions across ${[...v.sources].join(" + ")} in the last 24h). Treat this as a durable interest worth carrying into future replies.`,
    tags: ["sleep-cycle", "consolidated-theme", topic],
    source: "insight" as const,
    createdAt: isoNow(),
  }));

  try {
    await promoteInsights(promoted);
    log.info(`sleep-cycle: promoted ${promoted.length} consolidated themes — ${themes.map((t) => t[0]).join(", ")}`);
  } catch (e) {
    log.warn("sleep-cycle promotion failed", e);
  }

  await writeState({
    lastRanAt: isoNow(),
    totalThemes: (state?.totalThemes ?? 0) + promoted.length,
  });

  return { ran: true, themesPromoted: promoted.length, topicsExamined: counter.size };
}
