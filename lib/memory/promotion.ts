/**
 * Auto-promotion — self-organization of long-term memory.
 *
 * Every time `recall()` returns a memory with high confidence, we increment
 * a recall counter for that memory ID. When the counter reaches a threshold,
 * we copy the memory into the LanceDB `insights` table — which gets stronger
 * retrieval weight in the orchestrator's context assembly.
 *
 * Net effect: facts you reference repeatedly become *first-class memories*
 * automatically. The user doesn't tell the system what's important. The
 * system observes which memories prove their worth.
 *
 * Storage:  data/recall-counts.json
 *           {
 *             "<memoryId>": { hits, lastSeen, promoted, peakScore }
 *           }
 *
 * Fire-and-forget from the orchestrator post-retrieval. No user-visible
 * latency.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { promoteInsights } from "./lancedb";
import type { RetrievalHit } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("promotion");

const COUNTS_FILE = dataPath("recall-counts.json");

const PROMOTION_THRESHOLD = 3;
const PROMOTION_MIN_SCORE = 0.70;

interface RecallCount {
  hits: number;
  lastSeen: string;
  promoted?: boolean;
  peakScore: number;
}

type CountsMap = Record<string, RecallCount>;

let cache: CountsMap | null = null;

async function load(): Promise<CountsMap> {
  if (cache) return cache;
  try {
    const raw = await readFile(COUNTS_FILE, "utf8");
    cache = JSON.parse(raw) as CountsMap;
  } catch {
    cache = {};
  }
  return cache;
}

async function save(counts: CountsMap): Promise<void> {
  cache = counts;
  try {
    await mkdir(path.dirname(COUNTS_FILE), { recursive: true });
    await writeFile(COUNTS_FILE, JSON.stringify(counts), "utf8");
  } catch (e) {
    log.warn("recall-counts save failed", e);
  }
}

export async function trackRecalls(hits: RetrievalHit[]): Promise<{
  tracked: number;
  promoted: number;
}> {
  if (hits.length === 0) return { tracked: 0, promoted: 0 };

  const counts = await load();
  const toPromote: RetrievalHit[] = [];
  let tracked = 0;

  for (const hit of hits) {
    if (!hit.id) continue;
    if (hit.score < PROMOTION_MIN_SCORE) continue;
    if (hit.source === "insight") continue; // already first-class

    const c: RecallCount = counts[hit.id] ?? { hits: 0, lastSeen: "", peakScore: 0 };
    c.hits += 1;
    c.lastSeen = new Date().toISOString();
    c.peakScore = Math.max(c.peakScore, hit.score);
    counts[hit.id] = c;
    tracked++;

    if (c.hits >= PROMOTION_THRESHOLD && !c.promoted) {
      c.promoted = true;
      toPromote.push(hit);
    }
  }

  if (toPromote.length > 0) {
    try {
      await promoteInsights(
        toPromote.map((h) => ({
          id: `auto-${h.id}`,
          text: h.text,
          threadId: h.threadId,
          tags: Array.from(new Set([...(h.tags ?? []), "auto-promoted"])),
          source: "insight",
          createdAt: new Date().toISOString(),
        })),
      );
      log.info(`auto-promoted ${toPromote.length} memories to insights`);
    } catch (e) {
      log.warn("promotion write failed", e);
    }
  }

  await save(counts);
  return { tracked, promoted: toPromote.length };
}

/** Read the top-N most-frequently-recalled memories (for dashboard). */
export async function topRecalls(limit = 12): Promise<Array<{ id: string } & RecallCount>> {
  const counts = await load();
  return Object.entries(counts)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}
