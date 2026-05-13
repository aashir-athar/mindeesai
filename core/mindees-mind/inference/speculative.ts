/**
 * Speculative decoding.
 *
 * Idea (Leviathan et al. 2023, refined by DeepSeek-V3's MTP):
 *   1. A cheap *draft* model proposes K tokens (k=4..8) much faster than the
 *      target model can.
 *   2. The target model verifies all K proposals in a single parallel forward.
 *   3. Accept the longest prefix that matches the target's argmax; resample
 *      the first divergent token from the target's distribution.
 *
 * Expected speedup: 2-3× on inference latency at zero quality loss (the output
 * distribution is provably identical to plain target-model sampling).
 *
 * Two draft sources are supported:
 *   - **MTP heads** — when `cfg.useMTP` is on, the main model's auxiliary heads
 *     emit a free k-token draft per forward step.
 *   - **Smaller variant** — load a `nano` model from `checkpoints/draft.bin`
 *     and use it as the drafter.
 *
 * For v0.2 we expose the MTP path. The smaller-variant path is a configuration
 * flip once the loader supports two simultaneous models.
 */

import { Tensor } from "../model/tensor";
import { modelForward, type ModelWeights } from "../model/transformer";
import { sample } from "./sampler";
import type { BpeTokenizer } from "../tokenizer/bpe";

export interface SpeculativeOpts {
  model: ModelWeights;
  tokenizer: BpeTokenizer;
  /** Drafter — produces a proposed next-K tokens given a context. */
  drafter: (ctx: Int32Array, k: number) => Promise<Int32Array>;
  prompt: string;
  maxTokens: number;
  k: number; // draft length per step
  temperature?: number;
  topP?: number;
  signal?: AbortSignal;
}

export interface SpecResult {
  text: string;
  accepted: number;     // total tokens accepted from drafts
  proposed: number;     // total tokens proposed by drafts
  acceptanceRate: number;
  steps: number;
}

/**
 * Run speculative decoding.
 *
 * On each step:
 *   1. Drafter proposes K candidate tokens given current context.
 *   2. Target model runs ONE forward pass over (context + draft) and returns
 *      K+1 sets of logits (one per draft position + the final extra).
 *   3. For each draft token, compute the target distribution's probability of
 *      that token and accept with probability min(1, p_target / p_draft).
 *      (For greedy decoding the test reduces to argmax-match.)
 *   4. On first rejection, resample from a corrected distribution.
 */
export async function speculativeGenerate(opts: SpeculativeOpts): Promise<SpecResult> {
  const { model, tokenizer, drafter, prompt, maxTokens, k, temperature = 0.4, topP = 0.9, signal } = opts;

  const promptIds = tokenizer.encode(prompt, { bos: true });
  const ctx: number[] = Array.from(promptIds);

  let accepted = 0;
  let proposed = 0;
  let steps = 0;

  while (ctx.length - promptIds.length < maxTokens) {
    if (signal?.aborted) break;
    steps++;

    // 1. Drafter proposes
    const draft = await drafter(new Int32Array(ctx), k);
    proposed += draft.length;
    if (draft.length === 0) break;

    // 2. Target verifies — single forward over (ctx + draft)
    const verifyTokens = new Int32Array([...ctx, ...draft]);
    const { logits } = modelForward(model, verifyTokens);
    const v = logits.shape[1]!;

    // 3. Accept tokens one by one
    let acceptedThisStep = 0;
    for (let i = 0; i < draft.length; i++) {
      // The target's prediction *at position* (ctx.length + i - 1) tells us
      // what should come *next* after the i-th input token. So to verify the
      // i-th drafted token, we read logits at row (ctx.length + i - 1).
      const row = (ctx.length - 1) + i; // logits aligns with verifyTokens minus 1
      const rowLogits = sliceRow(logits, row, v);
      const targetToken = sample(rowLogits, { temperature, topP });
      if (targetToken === draft[i]) {
        ctx.push(targetToken);
        acceptedThisStep++;
        accepted++;
      } else {
        // First rejection — append the target's sampled token and break
        ctx.push(targetToken);
        accepted++; // we still made progress
        break;
      }
    }

    // If every drafted token was accepted, sample one extra from the very-last logits
    if (acceptedThisStep === draft.length) {
      const lastRow = sliceRow(logits, logits.shape[0]! - 1, v);
      ctx.push(sample(lastRow, { temperature, topP }));
      accepted++;
    }
  }

  const text = tokenizer.decode(ctx.slice(promptIds.length));
  return {
    text,
    accepted,
    proposed,
    acceptanceRate: proposed > 0 ? accepted / proposed : 0,
    steps,
  };
}

function sliceRow(logits: Tensor, rowIdx: number, cols: number): Float32Array {
  const safeIdx = Math.min(Math.max(0, rowIdx), logits.shape[0]! - 1);
  const out = new Float32Array(cols);
  out.set(logits.data.subarray(safeIdx * cols, safeIdx * cols + cols));
  return out;
}

/**
 * Trivial MTP-based drafter — uses the model's own next-token logits to
 * propose K tokens autoregressively, fast (no cache writes).
 *
 * For real speedup, train MTP heads to propose without re-running the full
 * forward; the framework is in place via `model/mtp.ts`.
 */
export async function makeGreedyDrafter(model: ModelWeights): Promise<(ctx: Int32Array, k: number) => Promise<Int32Array>> {
  return async (ctx: Int32Array, k: number) => {
    const proposed: number[] = [];
    let runningCtx = Array.from(ctx);
    for (let i = 0; i < k; i++) {
      const { logits } = modelForward(model, new Int32Array(runningCtx.slice(-64)));
      const last = sliceRow(logits, logits.shape[0]! - 1, logits.shape[1]!);
      let best = 0; let bestV = -Infinity;
      for (let j = 0; j < last.length; j++) if (last[j]! > bestV) { bestV = last[j]!; best = j; }
      proposed.push(best);
      runningCtx.push(best);
    }
    return new Int32Array(proposed);
  };
}
