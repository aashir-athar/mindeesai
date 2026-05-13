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
import { selfImproveTick } from "@/core/mindees-mind";
import { isoNow, nid, safeJson } from "@/lib/utils";
import type { Reflection } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("optimizer");

const WEIGHTS_FILE = path.join(process.cwd(), "data", "retrieval-weights.json");
const LOG_FILE = path.join(process.cwd(), "data", "improvement-log.jsonl");

const CONFIDENCE_THRESHOLD = 0.7;

export type OptimizationResult = {
  ranAt: string;
  promotedInsights: number;
  retrievalWeightsUpdated: number;
  gradient: { loss: number; tokens: number; ms: number };
};

export async function optimize(reflections: Reflection[], opts: { sinceMs: number; signal?: AbortSignal }): Promise<OptimizationResult> {
  const ranAt = isoNow();
  const highConf = reflections.filter((r) => r.confidence >= CONFIDENCE_THRESHOLD);

  // 1. Promote insights to retrieval
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

  // 2. Bump retrieval weights
  const retrievalWeightsUpdated = await bumpWeights(highConf);

  // 3. Run the native model's gradient-descent training tick
  let gradient = { loss: 0, tokens: 0, ms: 0 };
  try {
    gradient = await selfImproveTick({ sinceMs: opts.sinceMs, signal: opts.signal });
  } catch (e) {
    log.error("selfImproveTick failed", e);
  }

  await appendLog({
    ranAt,
    promotedInsights: highConf.length,
    retrievalWeightsUpdated,
    gradient,
  });

  return { ranAt, promotedInsights: highConf.length, retrievalWeightsUpdated, gradient };
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
