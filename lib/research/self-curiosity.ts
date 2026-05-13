/**
 * Self-curiosity — Mindees researches what IT is curious about.
 *
 * Distinct from auto-curiosity (which patches user gaps). This is the
 * loop that lets Mindees grow its OWN interests over time, instead of
 * only being reactive to the user.
 *
 * Signal sources:
 *   - **Mood: curiosity > 0.7** + a recently-seen topic the model wants
 *     to know more about (extracted from the last few user messages).
 *   - **Skill mastery gaps** — topics that have been mentioned several
 *     times across threads but Mindees has low recall depth on.
 *   - **Concepts adjacent to known-graph nodes** — pick a random "you"
 *     graph fact and research the OBJECT side (broaden the world model).
 *
 * Why this is the right thing to add:
 *   A real human friend doesn't only learn from you — they go away,
 *   think about what you said, look stuff up because THEY got curious,
 *   and come back with something new to say. That's the loop we're
 *   simulating here. Fires on cron, capped at 2 topics per tick, logged
 *   alongside the auto-research log.
 */

import { createLogger } from "@/lib/logger";
import { recentThreads } from "@/lib/memory/conversations";
import { readThread } from "@/lib/memory";
import { getMood } from "@/lib/persona/mood";
import { allTriples } from "@/lib/memory/graph";
import type { CuriosityTopic } from "./auto-curiosity";

const log = createLogger("self-curiosity");

const CURIOSITY_THRESHOLD = 0.65;

const CONTENT_STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "been",
  "what", "when", "where", "which", "while", "would", "could", "should",
  "your", "their", "them", "they", "into", "about", "after", "before",
  "make", "made", "want", "need", "know", "think", "feel", "good", "bad",
  "just", "really", "very", "much", "more", "less", "some", "such",
  "also", "even", "still", "yeah", "okay", "sure", "right",
]);

interface RecentTopic {
  topic: string;
  count: number;
  lastSeen: number;
}

async function gatherRecentTopics(): Promise<RecentTopic[]> {
  const threads = await recentThreads(2 * 24 * 60 * 60 * 1000).catch(() => []);
  const counter = new Map<string, { count: number; lastSeen: number }>();

  for (const t of threads.slice(0, 8)) {
    const msgs = await readThread(t.threadId).catch(() => []);
    for (const m of msgs.slice(-12)) {
      if (m.role !== "user") continue;
      const tokens = m.content
        .toLowerCase()
        .replace(/[^\p{L}\s'-]/gu, " ")
        .split(/\s+/)
        .filter((tok) => tok.length >= 6 && !CONTENT_STOPWORDS.has(tok));
      const seen = new Set<string>();
      for (const tok of tokens) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        const cur = counter.get(tok) ?? { count: 0, lastSeen: 0 };
        cur.count += 1;
        cur.lastSeen = new Date(m.createdAt).getTime();
        counter.set(tok, cur);
      }
    }
  }

  return Array.from(counter.entries())
    .map(([topic, v]) => ({ topic, count: v.count, lastSeen: v.lastSeen }))
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count);
}

/**
 * Pick what Mindees should go research about ITSELF this tick.
 * Returns at most `limit` topics, ranked by intrinsic interest.
 */
export async function pickSelfCuriosityTopics(limit = 2): Promise<CuriosityTopic[]> {
  try {
    const mood = await getMood();
    const curiosity = mood.values.curiosity ?? 0;
    if (curiosity < CURIOSITY_THRESHOLD) {
      log.info(`self-curiosity skipped: mood.curiosity ${curiosity.toFixed(2)} < ${CURIOSITY_THRESHOLD}`);
      return [];
    }

    const candidates: CuriosityTopic[] = [];

    // 1. Recurring topics from the user's recent messages
    const recent = await gatherRecentTopics();
    for (const r of recent.slice(0, limit * 2)) {
      candidates.push({
        topic: r.topic,
        priority: r.count + curiosity,
        reason: "user-uncertain", // re-use enum — Mindees is intrinsically curious about what's been on the user's mind
      });
    }

    // 2. Graph-adjacent — random "you" triple object, expand outward
    try {
      const triples = await allTriples();
      const youTriples = triples.filter((t) => t.subject === "you" || t.subject === "user");
      if (youTriples.length > 0) {
        const pick = youTriples[Math.floor(Math.random() * youTriples.length)];
        if (pick && pick.object.length >= 3 && pick.object.length <= 40) {
          candidates.push({
            topic: pick.object,
            priority: 1 + curiosity * 0.5,
            reason: "user-uncertain",
          });
        }
      }
    } catch { /* graph optional */ }

    // Dedup + sort
    const seen = new Set<string>();
    const unique = candidates
      .filter((c) => {
        const k = c.topic.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);

    return unique;
  } catch (e) {
    log.warn("self-curiosity pick failed", e);
    return [];
  }
}
