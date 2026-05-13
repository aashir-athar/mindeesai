/**
 * Multi-Token Prediction (MTP) auxiliary heads.
 *
 * Idea (DeepSeek-V3): instead of predicting only the next token (t+1), also
 * predict tokens (t+2), (t+3), … via small auxiliary modules. The extra losses
 * provide a denser training signal and have been shown to improve sample
 * efficiency by ~10-15% on the same data.
 *
 * At inference time, MTP heads can be used for *speculative decoding* (see
 * `inference/speculative.ts`): the MTP head emits a "draft" next-k tokens that
 * the main model verifies in parallel.
 *
 * Architecture per depth d∈{2..mtpDepth}:
 *   - Take the final hidden state h_t
 *   - Apply a transformer block (RMSNorm + linear)
 *   - Project to vocab via the tied embedding
 *
 * We keep the auxiliary blocks small (single linear + RMSNorm) to avoid
 * inflating parameter count.
 */

import { Tensor } from "./tensor";
import { matmul, rmsNorm } from "./ops";
import { applyLoraForward, type LoraAdapter } from "../train/lora";
import type { ModelConfig } from "./config";

export interface MTPHead {
  /** Per-depth projection (dModel, dModel). */
  wProj: Tensor;
  /** Per-depth RMSNorm gain. */
  norm: Tensor;
  loraProj: LoraAdapter;
}

export function initMTP(cfg: ModelConfig): MTPHead[] {
  if (!cfg.useMTP || cfg.mtpDepth <= 1) return [];
  const heads: MTPHead[] = [];
  for (let d = 1; d < cfg.mtpDepth; d++) {
    heads.push({
      wProj: Tensor.kaiming([cfg.dModel, cfg.dModel], cfg.dModel),
      norm: Tensor.ones([cfg.dModel]),
      loraProj: { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    });
  }
  return heads;
}

/**
 * For each depth d ∈ [2..mtpDepth], produce predicted logits for token (t+d).
 * Returns one Tensor per depth, all shape (T, vocab).
 */
export function mtpForward(
  finalHidden: Tensor,      // (T, dModel)
  heads: MTPHead[],
  embedding: Tensor,        // tied embedding (vocab, dModel)
  cfg: ModelConfig,
): Tensor[] {
  const out: Tensor[] = [];
  let h = finalHidden;
  for (const head of heads) {
    const normed = rmsNorm(h, head.norm, cfg.rmsNormEps);
    const projected = applyLoraForward(matmul(normed, head.wProj), normed, head.loraProj);
    // Project to vocab via tied embedding (h @ Wᵀ)
    const logits = projectToVocab(projected, embedding);
    out.push(logits);
    h = projected; // chain: next depth's projection works on the previous one
  }
  return out;
}

function projectToVocab(h: Tensor, W: Tensor): Tensor {
  const [t, d] = h.shape as [number, number];
  const [vocab, d2] = W.shape as [number, number];
  if (d !== d2) throw new Error(`projectToVocab shape mismatch ${h.shape} ${W.shape}`);
  const out = new Float32Array(t * vocab);
  for (let i = 0; i < t; i++) {
    for (let v = 0; v < vocab; v++) {
      let acc = 0;
      const wBase = v * d;
      for (let p = 0; p < d; p++) acc += h.data[i * d + p]! * W.data[wBase + p]!;
      out[i * vocab + v] = acc;
    }
  }
  return new Tensor(out, [t, vocab]);
}

/**
 * Compute the MTP loss across all depths and average.
 *
 * targets: full token sequence including future tokens. For depth `d`, the
 * head should predict tokens shifted by `d` (i.e. targets[d:]).
 */
export function mtpLoss(
  mtpLogits: Tensor[],
  tokens: Int32Array,
): { loss: number; perDepth: number[] } {
  const perDepth: number[] = [];
  if (mtpLogits.length === 0) return { loss: 0, perDepth };

  let total = 0;
  for (let d = 0; d < mtpLogits.length; d++) {
    const depth = d + 2; // depth 2 = next-next-token
    const logits = mtpLogits[d]!;
    const [t, v] = logits.shape as [number, number];
    const offset = depth - 1; // align: predict tokens[i+depth]
    if (t <= offset) { perDepth.push(0); continue; }
    let dLoss = 0;
    let dCount = 0;
    for (let i = 0; i < t - offset; i++) {
      const target = tokens[i + offset]!;
      // cross-entropy
      let mx = -Infinity;
      for (let c = 0; c < v; c++) if (logits.data[i * v + c]! > mx) mx = logits.data[i * v + c]!;
      let sumExp = 0;
      for (let c = 0; c < v; c++) sumExp += Math.exp(logits.data[i * v + c]! - mx);
      const lse = Math.log(sumExp) + mx;
      dLoss += lse - logits.data[i * v + target]!;
      dCount++;
    }
    const avg = dCount > 0 ? dLoss / dCount : 0;
    perDepth.push(avg);
    total += avg;
  }
  return { loss: total / mtpLogits.length, perDepth };
}
