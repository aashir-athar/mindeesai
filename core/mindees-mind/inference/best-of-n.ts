/**
 * Best-of-N sampling.
 *
 * Generate N completions in parallel, score each with the critic, return the
 * best. Trades latency for quality — a 4x latency cost for typically a 0.3-0.5
 * point reasoning-benchmark improvement.
 *
 * The UI exposes this as a "Hard mode" toggle. On easy questions, N=1 (no
 * change). On hard questions (detected by `estimateDifficulty`), N=4.
 */

import { generateText } from "../index";
import type { ModelWeights } from "../model/transformer";
import type { BpeTokenizer } from "../tokenizer/bpe";

export interface BestOfNOpts {
  prompt: string;
  n: number;
  scorer: (completion: string) => Promise<number>;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface BestOfNResult {
  best: string;
  bestScore: number;
  candidates: Array<{ text: string; score: number }>;
}

export async function bestOfN(opts: BestOfNOpts): Promise<BestOfNResult> {
  const { prompt, n, scorer, temperature = 0.8, topP = 0.95, maxTokens = 768, signal } = opts;

  // Generate N completions in parallel
  const candidates = await Promise.all(
    Array.from({ length: n }, () =>
      generateText(prompt, { temperature, topP, maxTokens, signal }),
    ),
  );

  // Score each
  const scored = await Promise.all(
    candidates.map(async (text) => ({ text, score: await scorer(text) })),
  );

  // Pick the winner (highest score; ties broken by first occurrence)
  let best = scored[0]!;
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.score > best.score) best = scored[i]!;
  }

  return { best: best.text, bestScore: best.score, candidates: scored };
}
