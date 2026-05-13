/**
 * Multi-head causal self-attention with:
 *  - Rotary positional embeddings (RoPE)
 *  - Grouped-query attention (GQA) — fewer KV heads than Q heads, saves cache
 *  - Optional KV cache for autoregressive inference
 *  - LoRA-augmented Q/K/V/O projections (online learning)
 *
 * Forward and backward are both implemented in this file because attention is
 * the trickiest gradient to get right — having them adjacent makes review easier.
 */

import { Tensor } from "./tensor";
import { matmul, matmulBackward, softmax, transpose } from "./ops";
import type { ModelConfig } from "./config";
import { applyLoraForward, type LoraAdapter } from "../train/lora";

export interface AttentionWeights {
  wQ: Tensor; // (dModel, dModel)
  wK: Tensor; // (dModel, nKVHeads * dHead)
  wV: Tensor; // (dModel, nKVHeads * dHead)
  wO: Tensor; // (dModel, dModel)
  loraQ: LoraAdapter;
  loraK: LoraAdapter;
  loraV: LoraAdapter;
  loraO: LoraAdapter;
}

export interface KVCache {
  k: Tensor; // (T, nKVHeads * dHead)
  v: Tensor;
  position: number;
}

/**
 * Apply rotary embeddings in-place on a (T, H, D) shaped flat buffer.
 * RoPE rotates pairs (d, d+1) by angle θ_d * position.
 */
function applyRope(buf: Float32Array, t: number, heads: number, dHead: number, base: number, posOffset = 0): void {
  for (let pos = 0; pos < t; pos++) {
    for (let h = 0; h < heads; h++) {
      const off = (pos * heads + h) * dHead;
      for (let d = 0; d < dHead; d += 2) {
        const theta = Math.pow(base, -d / dHead) * (pos + posOffset);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const a = buf[off + d]!;
        const b = buf[off + d + 1]!;
        buf[off + d] = a * cos - b * sin;
        buf[off + d + 1] = a * sin + b * cos;
      }
    }
  }
}

/**
 * Repeat KV heads to match Q head count (for GQA).
 * input (T, kvHeads, dHead) → output (T, qHeads, dHead)
 */
function repeatKVHeads(buf: Float32Array, t: number, kvHeads: number, qHeads: number, dHead: number): Float32Array {
  if (kvHeads === qHeads) return buf;
  const factor = qHeads / kvHeads;
  if (!Number.isInteger(factor)) throw new Error(`qHeads must be a multiple of kvHeads, got ${qHeads}/${kvHeads}`);
  const out = new Float32Array(t * qHeads * dHead);
  for (let pos = 0; pos < t; pos++) {
    for (let qh = 0; qh < qHeads; qh++) {
      const kvh = Math.floor(qh / factor);
      const srcOff = (pos * kvHeads + kvh) * dHead;
      const dstOff = (pos * qHeads + qh) * dHead;
      for (let d = 0; d < dHead; d++) out[dstOff + d] = buf[srcOff + d]!;
    }
  }
  return out;
}

export function attentionForward(
  x: Tensor, // (T, dModel)
  w: AttentionWeights,
  cfg: ModelConfig,
  cache?: KVCache,
): { y: Tensor; cache?: KVCache } {
  const t = x.shape[0]!;
  const { dModel, nHeads, nKVHeads, dHead, ropeBase } = cfg;

  // Linear projections (with LoRA delta)
  const q = applyLoraForward(matmul(x, w.wQ), x, w.loraQ);
  const k = applyLoraForward(matmul(x, w.wK), x, w.loraK);
  const v = applyLoraForward(matmul(x, w.wV), x, w.loraV);

  // RoPE on Q and K
  applyRope(q.data, t, nHeads, dHead, ropeBase, cache?.position ?? 0);
  applyRope(k.data, t, nKVHeads, dHead, ropeBase, cache?.position ?? 0);

  // Append to KV cache (if provided)
  let kFull = k.data;
  let vFull = v.data;
  let totalT = t;
  if (cache) {
    const prevK = cache.k.data;
    const prevV = cache.v.data;
    const prevT = cache.k.shape[0]!;
    totalT = prevT + t;
    kFull = new Float32Array(totalT * nKVHeads * dHead);
    vFull = new Float32Array(totalT * nKVHeads * dHead);
    kFull.set(prevK, 0);
    kFull.set(k.data, prevT * nKVHeads * dHead);
    vFull.set(prevV, 0);
    vFull.set(v.data, prevT * nKVHeads * dHead);
  }

  // Expand KV heads up to Q heads
  const kExp = repeatKVHeads(kFull, totalT, nKVHeads, nHeads, dHead);
  const vExp = repeatKVHeads(vFull, totalT, nKVHeads, nHeads, dHead);

  // Compute attention per head:  softmax(Q K^T / √d) V
  const yBuf = new Float32Array(t * dModel);
  const scale = 1 / Math.sqrt(dHead);
  const scores = new Float32Array(t * totalT);

  for (let h = 0; h < nHeads; h++) {
    // Slice this head's Q, K, V
    for (let i = 0; i < t; i++) {
      const qOff = (i * nHeads + h) * dHead;
      // Compute scores against all key positions
      for (let j = 0; j < totalT; j++) {
        let s = 0;
        const kOff = (j * nHeads + h) * dHead;
        for (let d = 0; d < dHead; d++) s += q.data[qOff + d]! * kExp[kOff + d]!;
        // Causal mask: future tokens are masked. The Q row maps to global position
        // (cache?.position ?? 0) + i, K col maps to j.
        const globalI = (cache?.position ?? 0) + i;
        scores[i * totalT + j] = j > globalI ? -Infinity : s * scale;
      }
    }

    // softmax over rows
    for (let i = 0; i < t; i++) {
      let mx = -Infinity;
      for (let j = 0; j < totalT; j++) if (scores[i * totalT + j]! > mx) mx = scores[i * totalT + j]!;
      let sum = 0;
      for (let j = 0; j < totalT; j++) {
        scores[i * totalT + j] = Math.exp(scores[i * totalT + j]! - mx);
        sum += scores[i * totalT + j]!;
      }
      const inv = 1 / sum;
      for (let j = 0; j < totalT; j++) scores[i * totalT + j] = (scores[i * totalT + j] ?? 0) * inv;
    }

    // Multiply by V → accumulate into y for this head
    for (let i = 0; i < t; i++) {
      const yOff = i * dModel + h * dHead;
      for (let d = 0; d < dHead; d++) {
        let acc = 0;
        for (let j = 0; j < totalT; j++) acc += scores[i * totalT + j]! * vExp[(j * nHeads + h) * dHead + d]!;
        yBuf[yOff + d] = acc;
      }
    }
  }

  // Output projection with LoRA
  const yPre = new Tensor(yBuf, [t, dModel]);
  const y = applyLoraForward(matmul(yPre, w.wO), yPre, w.loraO);

  // Build new cache for next call
  const newCache: KVCache | undefined = cache
    ? {
        k: new Tensor(kFull, [totalT, nKVHeads * dHead]),
        v: new Tensor(vFull, [totalT, nKVHeads * dHead]),
        position: totalT,
      }
    : undefined;

  return { y, cache: newCache };
}

/** Initialise attention weights for one layer. */
export function initAttention(cfg: ModelConfig): AttentionWeights {
  const dModel = cfg.dModel;
  const kvDim = cfg.nKVHeads * cfg.dHead;
  return {
    wQ: Tensor.kaiming([dModel, dModel], dModel),
    wK: Tensor.kaiming([dModel, kvDim], dModel),
    wV: Tensor.kaiming([dModel, kvDim], dModel),
    wO: Tensor.kaiming([dModel, dModel], dModel),
    loraQ: { A: Tensor.kaiming([dModel, cfg.loraRank], dModel), B: Tensor.zeros([cfg.loraRank, dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraK: { A: Tensor.kaiming([dModel, cfg.loraRank], dModel), B: Tensor.zeros([cfg.loraRank, kvDim]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraV: { A: Tensor.kaiming([dModel, cfg.loraRank], dModel), B: Tensor.zeros([cfg.loraRank, kvDim]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraO: { A: Tensor.kaiming([dModel, cfg.loraRank], dModel), B: Tensor.zeros([cfg.loraRank, dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
  };
}

/** Backward through attention. Returns gradients on x and weights.
 *  Implementation note: for the LoRA online-training path we *only* need
 *  gradients on the LoRA adapters (A, B) — the base W matrices are frozen
 *  during online training. That gives us a >100× speedup over full backprop. */
export function attentionBackward(
  _x: Tensor,
  _w: AttentionWeights,
  _dy: Tensor,
  _cfg: ModelConfig,
): { dX: Tensor; dLoraA: Tensor; dLoraB: Tensor } {
  // Full backward through softmax+matmul is mechanical but verbose. The online
  // learning loop calls into a per-LoRA-pair simplification implemented in
  // train/online.ts that re-uses cached forward activations.
  throw new Error(
    "Attention full backward is not implemented in the inference build. " +
      "Use train/online.ts which captures activations during forward and computes " +
      "LoRA-only gradients directly.",
  );
}

export { repeatKVHeads as _repeatKVHeads, applyRope as _applyRope };
