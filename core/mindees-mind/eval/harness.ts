/**
 * Continuous evaluation harness — runs after every training tick and gates the
 * commit/rollback decision.
 *
 * The harness composes three benchmarks (perplexity, reasoning, recall) into
 * a single "model health" snapshot. The optimizer compares the snapshot before
 * the training tick to the snapshot after. If quality regressed by more than
 * `MAX_REGRESSION` on any benchmark, the LoRA delta is rolled back to the
 * previous checkpoint.
 *
 * The full snapshot history lands in `data/eval-log.jsonl`, used by the UI
 * status widget to show the model's loss curve over time.
 */

import path from "node:path";
import { mkdir, appendFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { evaluatePerplexity } from "./benchmarks/perplexity";
import { evaluateReasoning } from "./benchmarks/reasoning";
import { evaluateRecall } from "./benchmarks/recall";
import type { ModelWeights } from "../model/transformer";
import type { BpeTokenizer } from "../tokenizer/bpe";
import { createLogger } from "@/lib/logger";

const log = createLogger("eval-harness");
const LOG = dataPath("eval-log.jsonl");

export interface EvalSnapshot {
  ts: string;
  perplexity: number;
  reasoning: number;
  recallAt3: number;
  ms: number;
}

/** Allowed degradation per metric — anything worse triggers a rollback. */
const MAX_REGRESSION = {
  perplexity: 0.15,  // PPL may grow at most 15%
  reasoning: 0.10,   // reasoning may drop at most 10 pp
  recallAt3: 0.10,
};

export async function runEval(model: ModelWeights, tokenizer: BpeTokenizer): Promise<EvalSnapshot> {
  const t0 = performance.now();
  const [perp, reason, recall] = await Promise.all([
    evaluatePerplexity(model, tokenizer).catch(() => ({ perplexity: Infinity, tokens: 0, ms: 0 })),
    evaluateReasoning(model, tokenizer).catch(() => ({ accuracy: 0, passed: 0, total: 0, ms: 0, perTask: [] })),
    evaluateRecall().catch(() => ({ recalledAtK: { k1: 0, k3: 0, k5: 0 }, total: 1, ms: 0 })),
  ]);

  const snapshot: EvalSnapshot = {
    ts: new Date().toISOString(),
    perplexity: perp.perplexity,
    reasoning: reason.accuracy,
    recallAt3: recall.total > 0 ? recall.recalledAtK.k3 / recall.total : 0,
    ms: performance.now() - t0,
  };

  await persist(snapshot);
  log.info(`eval: ppl=${snapshot.perplexity.toFixed(2)} reason=${snapshot.reasoning.toFixed(2)} recall@3=${snapshot.recallAt3.toFixed(2)} ${snapshot.ms.toFixed(0)}ms`);
  return snapshot;
}

/**
 * Compare two snapshots. Returns `true` if `after` is at least as good as
 * `before` on every regression-monitored metric.
 */
export function passesRegression(before: EvalSnapshot, after: EvalSnapshot): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (after.perplexity > before.perplexity * (1 + MAX_REGRESSION.perplexity)) {
    reasons.push(`perplexity regressed: ${before.perplexity.toFixed(2)} → ${after.perplexity.toFixed(2)}`);
  }
  if (after.reasoning < before.reasoning - MAX_REGRESSION.reasoning) {
    reasons.push(`reasoning regressed: ${(before.reasoning * 100).toFixed(0)}% → ${(after.reasoning * 100).toFixed(0)}%`);
  }
  if (after.recallAt3 < before.recallAt3 - MAX_REGRESSION.recallAt3) {
    reasons.push(`recall@3 regressed: ${(before.recallAt3 * 100).toFixed(0)}% → ${(after.recallAt3 * 100).toFixed(0)}%`);
  }
  return { passed: reasons.length === 0, reasons };
}

async function persist(s: EvalSnapshot): Promise<void> {
  await mkdir(path.dirname(LOG), { recursive: true });
  await appendFile(LOG, JSON.stringify(s) + "\n", "utf8");
}
