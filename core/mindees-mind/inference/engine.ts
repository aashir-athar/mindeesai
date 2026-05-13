/**
 * Inference engine — autoregressive generation with KV cache.
 *
 * Two entry points:
 *   `generate()`        — buffered, returns the final string
 *   `generateStream()`  — async iterable, yields each new token's decoded text
 *
 * Both honour an AbortSignal so the chat UI can cancel mid-stream.
 */

import { modelForward, emptyCaches, type ModelWeights } from "../model/transformer";
import { SPECIAL_TOKENS, type BpeTokenizer } from "../tokenizer/bpe";
import { sample, type SamplerOptions } from "./sampler";

export interface GenerateOpts extends SamplerOptions {
  model: ModelWeights;
  tokenizer: BpeTokenizer;
  prompt: string;
  /** Max new tokens to generate (not including the prompt). */
  maxTokens?: number;
  /** Stop when ANY of these strings appears in the decoded suffix. */
  stop?: string[];
  signal?: AbortSignal;
}

export async function generate(opts: GenerateOpts): Promise<string> {
  let buf = "";
  for await (const chunk of generateStream(opts)) buf += chunk;
  return buf;
}

export async function* generateStream(opts: GenerateOpts): AsyncIterable<string> {
  const { model, tokenizer, prompt, maxTokens = 256, stop = [], signal } = opts;
  const cfg = model.cfg;

  // Tokenize the prompt with BOS
  const promptIds = tokenizer.encode(prompt, { bos: true });
  const caches = emptyCaches(cfg);

  // Prime the cache with the entire prompt in one forward pass
  let { logits, caches: newCaches } = modelForward(model, promptIds, caches);
  const sessionCaches = newCaches!;
  let lastRow = sliceRow(logits, logits.shape[0]! - 1, logits.shape[1]!);

  const recentTokens: number[] = Array.from(promptIds);
  let produced = 0;

  while (produced < maxTokens) {
    if (signal?.aborted) return;

    const nextId = sample(lastRow, {
      ...opts,
      previousTokens: new Int32Array(recentTokens.slice(-128)),
    });

    if (nextId === SPECIAL_TOKENS.EOS) return;

    const piece = tokenizer.decode([nextId]);
    if (piece) {
      yield piece;
      // Check stop sequences against the trailing buffer
      for (const s of stop) {
        if (piece.endsWith(s)) return;
      }
    }
    recentTokens.push(nextId);

    // One-token forward to update cache and get next logits
    const step = modelForward(model, new Int32Array([nextId]), sessionCaches);
    const stepLogits = step.logits;
    // step.caches is the updated KVCache — overwrite in place by re-binding through references
    if (step.caches) {
      for (let i = 0; i < sessionCaches.length; i++) {
        sessionCaches[i] = step.caches[i]!;
      }
    }
    lastRow = sliceRow(stepLogits, stepLogits.shape[0]! - 1, stepLogits.shape[1]!);
    produced++;
  }
}

function sliceRow(logits: import("../model/tensor").Tensor, rowIdx: number, cols: number): Float32Array {
  const out = new Float32Array(cols);
  out.set(logits.data.subarray(rowIdx * cols, rowIdx * cols + cols));
  return out;
}
