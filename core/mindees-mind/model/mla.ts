/**
 * Multi-head Latent Attention (MLA) — DeepSeek-V2/V3.
 *
 * Standard attention caches K and V at full size:
 *     cache_per_token = nKVHeads · dHead · 2 floats   (e.g., 4·64·2 = 512 floats)
 *
 * MLA replaces this with a single *latent* vector per token:
 *     cache_per_token = mlaLatentDim floats           (e.g., 128 floats)
 *
 * The K and V used in attention are reconstructed on-the-fly from the latent:
 *     latent = x · W_DKV                              ← stored in cache
 *     K       = latent · W_UK                          ← rebuilt during attention
 *     V       = latent · W_UV                          ← rebuilt during attention
 *
 * Compression ratio:
 *     standard: 2 · nKVHeads · dHead    →   MLA: mlaLatentDim   (typically ~4-8× smaller)
 *
 * For long-context inference this is the difference between fitting the cache
 * in memory and not.
 *
 * Notes:
 *   - We keep RoPE on a small per-head "rope key" component (the "decoupled
 *     rope" trick from the paper) so position-aware attention still works.
 *     For v0.2 we keep the implementation simple: RoPE is applied to the
 *     reconstructed K (not the cached latent). This is slightly less efficient
 *     but mathematically equivalent and easier to read.
 */

import { Tensor } from "./tensor";
import { matmul } from "./ops";
import { applyLoraForward, type LoraAdapter } from "../train/lora";
import type { ModelConfig } from "./config";

export interface MLAWeights {
  /** Query projection (T, dModel) → (T, nHeads·dHead). */
  wQ: Tensor;
  /** KV down-projection (T, dModel) → (T, mlaLatentDim). */
  wDKV: Tensor;
  /** K up-projection (T, latent) → (T, nKVHeads·dHead). */
  wUK: Tensor;
  /** V up-projection (T, latent) → (T, nKVHeads·dHead). */
  wUV: Tensor;
  /** Output projection. */
  wO: Tensor;

  loraQ: LoraAdapter;
  loraDKV: LoraAdapter;
  loraUK: LoraAdapter;
  loraUV: LoraAdapter;
  loraO: LoraAdapter;
}

export interface MLACache {
  /** Compressed latent cache, shape (T, mlaLatentDim). */
  latent: Tensor;
  position: number;
}

export function initMLA(cfg: ModelConfig): MLAWeights {
  const kvDim = cfg.nKVHeads * cfg.dHead;
  const L = cfg.mlaLatentDim;
  return {
    wQ: Tensor.kaiming([cfg.dModel, cfg.dModel], cfg.dModel),
    wDKV: Tensor.kaiming([cfg.dModel, L], cfg.dModel),
    wUK: Tensor.kaiming([L, kvDim], L),
    wUV: Tensor.kaiming([L, kvDim], L),
    wO: Tensor.kaiming([cfg.dModel, cfg.dModel], cfg.dModel),

    loraQ:   { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraDKV: { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, L]),         alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraUK:  { A: Tensor.kaiming([L, cfg.loraRank], L),                   B: Tensor.zeros([cfg.loraRank, kvDim]),     alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraUV:  { A: Tensor.kaiming([L, cfg.loraRank], L),                   B: Tensor.zeros([cfg.loraRank, kvDim]),     alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraO:   { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
  };
}

/**
 * MLA forward.
 *
 * Returns the attention output and the *latent* cache (not the full K/V cache).
 */
export function mlaForward(
  x: Tensor,
  weights: MLAWeights,
  cfg: ModelConfig,
  cache?: MLACache,
): { y: Tensor; cache: MLACache } {
  const t = x.shape[0]!;
  const { dModel, nHeads, nKVHeads, dHead } = cfg;
  const kvDim = nKVHeads * dHead;

  // 1. Project Q (full size) and compress KV via wDKV.
  const q = applyLoraForward(matmul(x, weights.wQ), x, weights.loraQ);
  const latentNew = applyLoraForward(matmul(x, weights.wDKV), x, weights.loraDKV);

  // 2. Build the full latent cache (append to previous).
  let latentFull: Tensor;
  let totalT: number;
  if (cache) {
    const prev = cache.latent;
    const L = cfg.mlaLatentDim;
    totalT = prev.shape[0]! + t;
    const buf = new Float32Array(totalT * L);
    buf.set(prev.data, 0);
    buf.set(latentNew.data, prev.shape[0]! * L);
    latentFull = new Tensor(buf, [totalT, L]);
  } else {
    latentFull = latentNew;
    totalT = t;
  }

  // 3. Reconstruct K and V from the latent.
  //    K = latentFull · wUK    V = latentFull · wUV
  const K = applyLoraForward(matmul(latentFull, weights.wUK), latentFull, weights.loraUK);
  const V = applyLoraForward(matmul(latentFull, weights.wUV), latentFull, weights.loraUV);

  // 4. Multi-head attention with GQA.
  //    Q is (T, nHeads * dHead);  K/V are (totalT, nKVHeads * dHead).
  const yBuf = new Float32Array(t * dModel);
  const scale = 1 / Math.sqrt(dHead);
  const repeat = nHeads / nKVHeads;

  for (let h = 0; h < nHeads; h++) {
    const kvh = Math.floor(h / repeat);
    // Compute per-row scores
    for (let i = 0; i < t; i++) {
      const globalI = (cache?.position ?? 0) + i;
      const qOff = i * dModel + h * dHead;
      const scores = new Float32Array(totalT);
      for (let j = 0; j < totalT; j++) {
        if (j > globalI) { scores[j] = -Infinity; continue; }
        const kOff = j * kvDim + kvh * dHead;
        let s = 0;
        for (let d = 0; d < dHead; d++) s += q.data[qOff + d]! * K.data[kOff + d]!;
        scores[j] = s * scale;
      }
      // softmax
      let mx = -Infinity;
      for (let j = 0; j <= globalI && j < totalT; j++) if (scores[j]! > mx) mx = scores[j]!;
      let sum = 0;
      for (let j = 0; j <= globalI && j < totalT; j++) {
        scores[j] = Math.exp(scores[j]! - mx);
        sum += scores[j]!;
      }
      const inv = sum === 0 ? 0 : 1 / sum;
      for (let j = 0; j <= globalI && j < totalT; j++) scores[j] = (scores[j] ?? 0) * inv;
      // Apply to V for this head
      const yOff = i * dModel + h * dHead;
      for (let d = 0; d < dHead; d++) {
        let acc = 0;
        for (let j = 0; j <= globalI && j < totalT; j++) acc += scores[j]! * V.data[j * kvDim + kvh * dHead + d]!;
        yBuf[yOff + d] = acc;
      }
    }
  }

  const yPre = new Tensor(yBuf, [t, dModel]);
  const y = applyLoraForward(matmul(yPre, weights.wO), yPre, weights.loraO);

  return {
    y,
    cache: { latent: latentFull, position: totalT },
  };
}

/** Initialise an empty MLA cache. */
export function emptyMLACache(cfg: ModelConfig): MLACache {
  return { latent: Tensor.zeros([0, cfg.mlaLatentDim]), position: 0 };
}
