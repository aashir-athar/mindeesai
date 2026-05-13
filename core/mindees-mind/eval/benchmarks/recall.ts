/**
 * Recall benchmark — does the model surface the right memory when asked a
 * question whose answer lives in long-term storage?
 *
 * Procedure (per item):
 *   1. Insert a synthetic "fact" into the memory store.
 *   2. Phrase a question whose correct answer references that fact.
 *   3. Run the orchestrator's retrieval step.
 *   4. Check whether the inserted fact appears in the top-K results.
 *
 * This catches the most common failure mode in continual-learning systems:
 * the model "forgets" because retrieval started over-weighting recent topics.
 */

import { rememberMany, recall } from "@/lib/memory/lancedb";
import { nid, isoNow } from "@/lib/utils";

const TEST_ITEMS = [
  { fact: "The capital of the fictional country Verdania is Aurelia, founded in 1742.", question: "Verdania capital" },
  { fact: "Aashir's preferred coffee order is a flat white with two extra shots.", question: "Aashir's coffee" },
  { fact: "The MindeesAI release codename for version 1.0 is 'Lumen'.", question: "MindeesAI 1.0 codename" },
];

export interface RecallEvalResult {
  recalledAtK: { k1: number; k3: number; k5: number };
  total: number;
  ms: number;
}

const TEST_TAG = "__mindees_eval_recall__";

export async function evaluateRecall(): Promise<RecallEvalResult> {
  const t0 = performance.now();

  // Seed the items (idempotent via deterministic IDs)
  await rememberMany(
    TEST_ITEMS.map((it, i) => ({
      id: `${TEST_TAG}_${i}`,
      text: it.fact,
      tags: [TEST_TAG],
      source: "conversation" as const,
      createdAt: isoNow(),
    })),
  );

  let k1 = 0;
  let k3 = 0;
  let k5 = 0;
  for (const item of TEST_ITEMS) {
    const hits = await recall(item.question, 5);
    if (hits.some((h, i) => i === 0 && h.text === item.fact)) k1++;
    if (hits.slice(0, 3).some((h) => h.text === item.fact)) k3++;
    if (hits.slice(0, 5).some((h) => h.text === item.fact)) k5++;
  }

  void nid;
  return {
    recalledAtK: { k1, k3, k5 },
    total: TEST_ITEMS.length,
    ms: performance.now() - t0,
  };
}
