/**
 * Idle-time topic exploration.
 *
 * Runs inside the cron tick. Pulls a small list of "thin" topics —
 * areas Mindees has touched but has shallow depth on — and fires
 * an auto-research call for each. The result lands in LanceDB as
 * recallable memories. Next time the user mentions one of these
 * topics, Mindees has fresh substance ready.
 *
 * Selection rules:
 *   - Topic must have been mentioned in a conversation recently
 *     (we read the goal + skill map for candidates).
 *   - Skill depth < 0.5 AND skill confidence < 0.7  (not already strong).
 *   - Last study age > 24h  (don't thrash on the same topic).
 *   - Cap N per tick so we don't blow Tavily's free tier.
 *
 * This is the OUT-OF-CONVERSATION self-improvement loop, complementing
 * the IN-CONVERSATION auto-research that fires on hedges/novelty.
 */

import { performAutoResearch } from "./auto-research";
import { topSkills, studyTopic } from "./skill-mastery";
import { listThreads } from "@/lib/threads/metadata";
import { createLogger } from "@/lib/logger";

const log = createLogger("idle-explore");

const MAX_PER_TICK = 2;
const MIN_AGE_HOURS = 24;

export interface IdleExploreReport {
  candidatesConsidered: number;
  topicsResearched: string[];
  durationMs: number;
}

export async function idleExploreTick(): Promise<IdleExploreReport> {
  const t0 = performance.now();
  const researched: string[] = [];

  // Source 1: top thin skills (already-known but shallow)
  const skills = await topSkills(40);
  const candidates: string[] = [];
  for (const s of skills) {
    if (s.depth < 0.5 && s.confidence < 0.7) {
      const lastMs = new Date(s.last_studied).getTime();
      const hoursOld = isFinite(lastMs) ? (Date.now() - lastMs) / 3_600_000 : Infinity;
      if (hoursOld > MIN_AGE_HOURS) {
        candidates.push(s.topic.replace(/-/g, " "));
      }
    }
  }

  // Source 2: goals of recent threads (high-signal — user actually working on these)
  try {
    const threads = await listThreads(8);
    for (const t of threads) {
      // crude topic extraction: first 4 words of preview / lastUserMsg
      const src = t.lastUserMsg || t.preview || t.title;
      if (!src) continue;
      const phrase = src.split(/\s+/).slice(0, 6).join(" ").trim();
      if (phrase.length >= 12) candidates.push(phrase);
    }
  } catch {/* ignore */}

  // Dedupe (preserve order) and cap
  const seen = new Set<string>();
  const picks: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(c);
    if (picks.length >= MAX_PER_TICK) break;
  }

  for (const topic of picks) {
    try {
      const result = await performAutoResearch({ topic });
      if (result && result.passages > 0) {
        await studyTopic({ topic, via: "research", sourceCount: result.passages });
        researched.push(topic);
        log.info(`idle-explore researched "${topic}" → ${result.passages} passages`);
      }
    } catch (e) {
      log.warn(`idle-explore failed for "${topic}"`, e);
    }
  }

  return {
    candidatesConsidered: candidates.length,
    topicsResearched: researched,
    durationMs: performance.now() - t0,
  };
}
