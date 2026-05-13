/**
 * Perplexity benchmark — the universal "is this model getting better?" metric.
 *
 * Runs the model over a held-out evaluation corpus and computes:
 *   PPL = exp(mean negative log-likelihood per token)
 *
 * Lower is better. Used by the regression gate to decide whether to
 * commit/rollback a training tick.
 */

import { forwardWithTape } from "../../model/forward-with-tape";
import { crossEntropy } from "../../model/ops";
import type { ModelWeights } from "../../model/transformer";
import type { BpeTokenizer } from "../../tokenizer/bpe";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const EVAL_CORPUS = dataPath("eval", "perplexity.txt");

export interface PerplexityResult {
  perplexity: number;
  tokens: number;
  ms: number;
}

/**
 * Compute perplexity on the held-out corpus.  If the corpus file doesn't exist,
 * lazily seeds it with a 5kb sample of high-quality general-purpose text so the
 * eval can always run.
 */
export async function evaluatePerplexity(model: ModelWeights, tokenizer: BpeTokenizer): Promise<PerplexityResult> {
  const t0 = performance.now();
  await ensureCorpus();
  const text = await readFile(EVAL_CORPUS, "utf8");
  const tokens = tokenizer.encode(text);
  const cap = Math.min(tokens.length, model.cfg.contextLength);
  if (cap < 2) return { perplexity: Infinity, tokens: 0, ms: 0 };

  const inputs = tokens.slice(0, cap - 1);
  const targets = tokens.slice(1, cap);
  const { logits } = forwardWithTape(model, inputs);
  const { loss } = crossEntropy(logits, targets);
  return {
    perplexity: Math.exp(loss),
    tokens: targets.length,
    ms: performance.now() - t0,
  };
}

async function ensureCorpus(): Promise<void> {
  try {
    await readFile(EVAL_CORPUS, "utf8");
  } catch {
    await mkdir(path.dirname(EVAL_CORPUS), { recursive: true });
    // Tiny seed corpus — general-purpose, copyright-free.
    const seed = `The model is not the world. The map is not the territory. A theory is only as good as the predictions it makes, and predictions are only as good as the experiments that test them. To know a thing is to be able to do something with it. The first principle is that you must not fool yourself, and you are the easiest person to fool. Intelligence is the ability to adapt to change. Curiosity precedes understanding. Mistakes are evidence that you tried. Compassion is intelligence applied to other people. The mind, once stretched by a new idea, never returns to its original dimensions. Knowledge is power, but only when applied. The unexamined life is not worth living. We are what we repeatedly do. Excellence is a habit. Patience is bitter, but its fruit is sweet.`;
    await writeFile(EVAL_CORPUS, seed, "utf8");
  }
}
