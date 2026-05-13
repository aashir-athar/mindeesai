/**
 * Training-data pipeline — dedup, quality filter, curriculum scheduler.
 *
 * The pipeline transforms raw conversation/reflection/curriculum batches into
 * a single curated microbatch the trainer consumes every 5 minutes. Three
 * filters run in sequence:
 *
 *   1. Dedup        — drop near-duplicate samples (shingled-MinHash signature)
 *   2. Quality      — drop low-quality samples (length + entropy + repetition)
 *   3. Curriculum   — order by difficulty; easier first within a tick
 *
 * Tunable thresholds live in `PIPELINE_CONFIG` at the bottom.
 */

import type { TrainBatch } from "../train/online";

export interface PipelineResult {
  kept: TrainBatch[];
  dropped: { dedup: number; quality: number };
  diagnostics: {
    totalIn: number;
    totalOut: number;
    bySource: Record<string, number>;
  };
}

const PIPELINE_CONFIG = {
  minTokenLen: 8,
  maxTokenLen: 4096,
  /** Drop samples whose unique-token ratio is below this (repetition signal). */
  minUniqueRatio: 0.15,
  /** Drop samples whose top-token frequency exceeds this (e.g. spam). */
  maxTopTokenFrac: 0.35,
  /** Two samples whose 5-gram signature overlaps by ≥ this fraction are duplicates. */
  dedupOverlap: 0.85,
  /** Number of shingles (5-grams) to sample for the MinHash signature. */
  shingleSample: 16,
};

export function curate(batches: TrainBatch[]): PipelineResult {
  const bySource: Record<string, number> = {};
  for (const b of batches) bySource[b.source] = (bySource[b.source] ?? 0) + 1;

  // 1. Quality filter
  const qualityOk: TrainBatch[] = [];
  let droppedQuality = 0;
  for (const b of batches) {
    if (passesQuality(b)) qualityOk.push(b);
    else droppedQuality++;
  }

  // 2. Dedup
  const seen: Array<{ sig: Set<number>; batch: TrainBatch }> = [];
  let droppedDedup = 0;
  for (const b of qualityOk) {
    const sig = shingleSignature(b.tokens);
    const dup = seen.find((s) => jaccard(s.sig, sig) >= PIPELINE_CONFIG.dedupOverlap);
    if (dup) { droppedDedup++; continue; }
    seen.push({ sig, batch: b });
  }

  // 3. Curriculum order — by length proxy for difficulty (shorter = easier)
  const ordered = seen.map((s) => s.batch).sort((a, b) => a.tokens.length - b.tokens.length);

  return {
    kept: ordered,
    dropped: { dedup: droppedDedup, quality: droppedQuality },
    diagnostics: { totalIn: batches.length, totalOut: ordered.length, bySource },
  };
}

function passesQuality(b: TrainBatch): boolean {
  if (b.tokens.length < PIPELINE_CONFIG.minTokenLen) return false;
  if (b.tokens.length > PIPELINE_CONFIG.maxTokenLen) return false;
  const counts = new Map<number, number>();
  for (let i = 0; i < b.tokens.length; i++) counts.set(b.tokens[i]!, (counts.get(b.tokens[i]!) ?? 0) + 1);
  const uniqueRatio = counts.size / b.tokens.length;
  if (uniqueRatio < PIPELINE_CONFIG.minUniqueRatio) return false;
  let maxFreq = 0;
  for (const c of counts.values()) if (c > maxFreq) maxFreq = c;
  if (maxFreq / b.tokens.length > PIPELINE_CONFIG.maxTopTokenFrac) return false;
  return true;
}

function shingleSignature(tokens: Int32Array): Set<number> {
  // 5-gram rolling hash of a stable subset
  const sig = new Set<number>();
  const stride = Math.max(1, Math.floor(tokens.length / PIPELINE_CONFIG.shingleSample));
  for (let i = 0; i + 5 <= tokens.length; i += stride) {
    let h = 0;
    for (let k = 0; k < 5; k++) {
      h = (h * 31 + (tokens[i + k] ?? 0)) | 0;
    }
    sig.add(h);
    if (sig.size >= PIPELINE_CONFIG.shingleSample) break;
  }
  return sig;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
