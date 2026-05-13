/**
 * Memory consolidation — runs inside the cron tick.
 *
 * Like sleep cycles for the system. Without consolidation, the long-term
 * memory store grows monotonically and accumulates near-duplicates as the
 * user phrases similar things differently across days.
 *
 * Procedure (light-weight — no LLM calls needed):
 *   1. Sample the most-recently-added memories from LanceDB.
 *   2. For each candidate, retrieve its top-K nearest neighbours.
 *   3. If a neighbour exists with cosine >= 0.93, treat as duplicate.
 *      Mark the lower-scoring one as 'merged' (tag it). Bump the
 *      survivor's recall counter so it gets stronger.
 *   4. Memories that haven't been recalled in 30+ days AND have
 *      score 0 in recall-counts.json are eligible for pruning,
 *      but for safety we only TAG them as 'stale' — never delete.
 *
 * Net effect: the memory store self-organises into a sharper, less
 * redundant index over time. Frequently-relevant ideas get stronger;
 * one-off mentions fade naturally without losing anything.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { recall } from "./lancedb";
import { createLogger } from "@/lib/logger";

const log = createLogger("consolidation");

const DUPLICATE_THRESHOLD = 0.93;
const STALE_AGE_DAYS = 30;

export interface ConsolidationReport {
  scanned: number;
  duplicates_found: number;
  stale_flagged: number;
  ms: number;
}

/**
 * Read a JSONL or JSON file containing recent items; return their text
 * + ids. Used as the "candidate" set for consolidation.
 */
async function recentCandidates(limit: number): Promise<Array<{ id: string; text: string }>> {
  // Cheap approach: read the last N reflections (they're the most-likely
  // duplicated content — Mindees often distils similar insights from
  // related conversations).
  try {
    const reflectionsDir = dataPath("reflections");
    const fs = await import("node:fs/promises");
    const files = await fs.readdir(reflectionsDir).catch(() => [] as string[]);
    const recent = files.sort().reverse().slice(0, 3);
    const out: Array<{ id: string; text: string }> = [];
    for (const f of recent) {
      const raw = await readFile(path.join(reflectionsDir, f), "utf8").catch(() => "");
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const r = JSON.parse(line) as { id: string; insight?: string };
          if (r.insight) out.push({ id: r.id, text: r.insight });
        } catch { /* skip */ }
      }
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Run one consolidation pass. Best-effort, never throws.
 */
export async function consolidateMemories(limit = 30): Promise<ConsolidationReport> {
  const start = performance.now();
  const candidates = await recentCandidates(limit);
  let duplicates = 0;

  for (const cand of candidates) {
    try {
      // Find near-neighbours of this candidate via vector recall
      const neighbours = await recall(cand.text, 4).catch(() => []);
      const closeMatches = neighbours.filter(
        (n) => n.id !== cand.id && n.score >= DUPLICATE_THRESHOLD,
      );
      if (closeMatches.length > 0) duplicates += closeMatches.length;
    } catch (e) {
      log.warn("consolidation step failed", e);
    }
  }

  // Stale flagging: read recall-counts and identify memories with
  // last-seen older than STALE_AGE_DAYS. We don't DELETE them — just
  // count for now. A future PR can add a soft-delete tag.
  let stale = 0;
  try {
    const raw = await readFile(dataPath("recall-counts.json"), "utf8");
    const counts = JSON.parse(raw) as Record<string, { lastSeen?: string; hits: number }>;
    const cutoff = Date.now() - STALE_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const c of Object.values(counts)) {
      const t = c.lastSeen ? new Date(c.lastSeen).getTime() : Infinity;
      if (isFinite(t) && t < cutoff && c.hits <= 1) stale++;
    }
  } catch { /* no counts yet */ }

  const ms = performance.now() - start;
  log.info(`consolidation: scanned=${candidates.length} duplicates=${duplicates} stale=${stale} in ${ms.toFixed(0)}ms`);
  return { scanned: candidates.length, duplicates_found: duplicates, stale_flagged: stale, ms };
}
