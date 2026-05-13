/**
 * Flash-attention-style chunked softmax.
 *
 * Standard attention requires storing the (T, T) score matrix — O(T²) memory.
 * For long context this is the bottleneck. Flash attention computes the same
 * output using O(T) memory by tiling the sequence and using *online softmax*:
 *
 *   For each query block Q_i:
 *     m_i = −∞, ℓ_i = 0, O_i = 0
 *     For each key/value block K_j, V_j:
 *       s = Q_i · K_jᵀ / √d
 *       m_new = max(m_i, max(s))
 *       p     = exp(s − m_new)
 *       ℓ_new = exp(m_i − m_new) · ℓ_i + sum(p)
 *       O_i   = (exp(m_i − m_new) · ℓ_i · O_i + p · V_j) / ℓ_new
 *       m_i, ℓ_i = m_new, ℓ_new
 *
 * The output is bit-identical to standard softmax-then-matmul, but never
 * materialises the (T, T) matrix.
 *
 * This implementation is a TS port of the algorithm. For production speed,
 * the WebGPU kernel in `runtime/webgpu.ts` is the place to land this — but
 * even the JS version saves memory on long-context training batches.
 */

import { Tensor } from "../model/tensor";

export function flashAttention(
  q: Tensor, k: Tensor, v: Tensor,
  opts: { causal: boolean; blockSize?: number; nHeads: number; dHead: number },
): Tensor {
  const [t, dModel] = q.shape as [number, number];
  const B = opts.blockSize ?? 64;
  const H = opts.nHeads;
  const D = opts.dHead;
  const scale = 1 / Math.sqrt(D);

  const out = new Float32Array(t * dModel);

  for (let h = 0; h < H; h++) {
    // Per-row running statistics
    const m = new Float32Array(t).fill(-Infinity);
    const ell = new Float32Array(t);
    // We'll accumulate the per-head output buffer in place.

    for (let bj = 0; bj < t; bj += B) {
      const jEnd = Math.min(t, bj + B);
      for (let bi = 0; bi < t; bi += B) {
        const iEnd = Math.min(t, bi + B);

        for (let i = bi; i < iEnd; i++) {
          const qOff = i * dModel + h * D;
          // Compute scores for this (i, j ∈ [bj, jEnd)) block
          const blockLen = jEnd - bj;
          const scores = new Float32Array(blockLen);
          for (let j = 0; j < blockLen; j++) {
            const jGlobal = bj + j;
            if (opts.causal && jGlobal > i) { scores[j] = -Infinity; continue; }
            const kOff = jGlobal * dModel + h * D;
            let s = 0;
            for (let d = 0; d < D; d++) s += q.data[qOff + d]! * k.data[kOff + d]!;
            scores[j] = s * scale;
          }

          // Online softmax update
          let mBlock = -Infinity;
          for (let j = 0; j < blockLen; j++) if (scores[j]! > mBlock) mBlock = scores[j]!;
          const mNew = Math.max(m[i]!, mBlock);
          const scaleOld = Math.exp(m[i]! - mNew);
          let sumExp = 0;
          for (let j = 0; j < blockLen; j++) {
            scores[j] = Math.exp(scores[j]! - mNew);
            sumExp += scores[j]!;
          }
          const ellNew = scaleOld * ell[i]! + sumExp;

          // Re-scale existing output, add the new block's contribution
          const oOff = i * dModel + h * D;
          for (let d = 0; d < D; d++) out[oOff + d] = (out[oOff + d] ?? 0) * scaleOld;
          for (let j = 0; j < blockLen; j++) {
            const w = scores[j]!;
            if (w === 0) continue;
            const vOff = (bj + j) * dModel + h * D;
            for (let d = 0; d < D; d++) out[oOff + d] = (out[oOff + d] ?? 0) + w * v.data[vOff + d]!;
          }

          m[i] = mNew;
          ell[i] = ellNew;
        }
      }
    }

    // Final normalisation
    for (let i = 0; i < t; i++) {
      const inv = 1 / Math.max(ell[i]!, 1e-12);
      const oOff = i * dModel + h * D;
      for (let d = 0; d < D; d++) out[oOff + d] = (out[oOff + d] ?? 0) * inv;
    }
  }

  return new Tensor(out, q.shape);
}
