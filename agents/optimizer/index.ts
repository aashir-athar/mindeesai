/**
 * Optimizer — promotes high-confidence reflections AND runs the native model's
 * gradient-descent training tick.
 *
 * Two concerns combined here because they fire together every 5 minutes:
 *   1. RETRIEVAL improvement — promote insights into LanceDB so future
 *      conversations recall them.
 *   2. WEIGHT improvement — actually update the neural network via
 *      `mindees.selfImproveTick()`.
 *
 * The audit trail goes to `data/improvement-log.jsonl`.
 */

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { promoteInsights } from "@/lib/memory/lancedb";
import { consolidateMemories } from "@/lib/memory/consolidation";
import { applyDecay as decaySkills } from "@/lib/persona/skill-mastery";
import { idleExploreTick } from "@/lib/persona/idle-explore";
import { maybeWriteJournalEntry } from "@/lib/persona/journal";
import { selfImproveTick } from "@/core/mindees-mind";
import { isoNow, nid, safeJson } from "@/lib/utils";
import type { Reflection } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { dataPath } from "@/lib/paths";

const log = createLogger("optimizer");

const WEIGHTS_FILE = dataPath("retrieval-weights.json");
const LOG_FILE = dataPath("improvement-log.jsonl");

const CONFIDENCE_THRESHOLD = 0.7;

export type OptimizationResult = {
  ranAt: string;
  promotedInsights: number;
  retrievalWeightsUpdated: number;
  gradient: { loss: number; tokens: number; ms: number };
};

export async function optimize(
  reflections: Reflection[],
  opts: { sinceMs: number; signal?: AbortSignal; budgetMs?: number },
): Promise<OptimizationResult & { skipped: string[] }> {
  const ranAt = isoNow();
  // budget defaults to "no cap" for non-Hobby callers (GH Actions etc).
  // The cron route passes ~40s on Hobby. Below each threshold we SKIP the
  // step rather than crash the function.
  const start = Date.now();
  const budgetMs = opts.budgetMs ?? Infinity;
  const remaining = () => budgetMs === Infinity ? Infinity : Math.max(0, budgetMs - (Date.now() - start));
  const skipped: string[] = [];

  const highConf = reflections.filter((r) => r.confidence >= CONFIDENCE_THRESHOLD);

  // 1. Promote insights to retrieval — fast (LanceDB write), always runs.
  if (highConf.length > 0) {
    await promoteInsights(
      highConf.map((r) => ({
        id: r.id,
        text: r.insight,
        threadId: r.threadId,
        tags: [r.retrievalTag],
        source: "insight",
        createdAt: r.createdAt,
      })),
    );
  }

  // 2. Bump retrieval weights — fast (single JSON read+write), always runs.
  const retrievalWeightsUpdated = await bumpWeights(highConf);

  // 3. Memory consolidation — does LanceDB recall calls, can take 5-15s.
  //    Skip if <10s budget.
  let consolidation = { scanned: 0, duplicates_found: 0, stale_flagged: 0, ms: 0 };
  if (remaining() > 10_000) {
    try { consolidation = await consolidateMemories(30); }
    catch (e) { log.warn("consolidation failed", e); }
  } else { skipped.push("consolidation"); }

  // 4. Skill decay — fast, always runs.
  try { await decaySkills(); } catch (e) { log.warn("skill decay failed", e); }

  // 4b. Idle-time exploration: research call (5-20s) — skip if <15s.
  let idleExplore = { candidatesConsidered: 0, topicsResearched: [] as string[], durationMs: 0 };
  if (remaining() > 15_000) {
    try { idleExplore = await idleExploreTick(); }
    catch (e) { log.warn("idle-explore failed", e); }
  } else { skipped.push("idle-explore"); }

  // 4c. Journal entry — one Groq call, can take 5-10s. Skip if <8s.
  let journalEntry: { written: boolean; preview?: string } = { written: false };
  if (remaining() > 8_000) {
    try {
      const entry = await maybeWriteJournalEntry();
      if (entry) journalEntry = { written: true, preview: entry.entry.slice(0, 120) };
    } catch (e) { log.warn("journal failed", e); }
  } else { skipped.push("journal"); }

  // 5. Heavy training tick — many Groq calls + gradient steps. On Hobby
  //    (60s ceiling) this almost always exceeds the remaining budget,
  //    so we skip unless we have >30s left. The weekly GH Actions
  //    pretrain workflow is the proper home for full training; this
  //    5-min cron just keeps the lightweight loops alive.
  let gradient = { loss: 0, tokens: 0, ms: 0 };
  if (remaining() > 30_000) {
    try {
      gradient = await selfImproveTick({ sinceMs: opts.sinceMs, signal: opts.signal });
    } catch (e) { log.error("selfImproveTick failed", e); }
  } else { skipped.push("selfImproveTick"); }

  await appendLog({
    ranAt,
    elapsedMs: Date.now() - start,
    promotedInsights: highConf.length,
    retrievalWeightsUpdated,
    consolidation,
    idleExplore,
    journalEntry,
    gradient,
    skipped,
  });

  return { ranAt, promotedInsights: highConf.length, retrievalWeightsUpdated, gradient, skipped };
}

async function bumpWeights(insights: Reflection[]): Promise<number> {
  let current: Record<string, number> = {};
  try {
    current = safeJson<Record<string, number>>(await readFile(WEIGHTS_FILE, "utf8")) ?? {};
  } catch {
    // none yet
  }
  let changed = 0;
  for (const i of insights) {
    const prev = current[i.retrievalTag] ?? 1.0;
    const bump = 0.1 * i.confidence;
    current[i.retrievalTag] = Math.min(prev + bump, 3.0);
    changed++;
  }
  // Gentle decay on untouched tags
  for (const k of Object.keys(current)) {
    if (!insights.find((i) => i.retrievalTag === k)) {
      current[k] = Math.max((current[k] ?? 1) * 0.98, 1.0);
    }
  }
  await mkdir(path.dirname(WEIGHTS_FILE), { recursive: true });
  await writeFile(WEIGHTS_FILE, JSON.stringify(current, null, 2), "utf8");
  return changed;
}

async function appendLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, JSON.stringify({ id: nid(), ...entry }) + "\n", "utf8");
}
