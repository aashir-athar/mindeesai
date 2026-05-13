/**
 * LoRA adapters — the trick that makes 5-minute online fine-tuning actually feasible.
 *
 * Idea:  W' = W + α/r · B·A    where  A ∈ (d_in, r),  B ∈ (r, d_out),  r ≪ min(d_in, d_out).
 * Training only A and B (frozen W) is **rank·(d_in + d_out)** parameters instead
 * of **d_in · d_out**. For r=8, dModel=512, that's a 32× drop. For dModel=2048
 * it's a 128× drop.
 *
 * Forward:    y = x·W + (α/r) · (x·A)·B
 * Gradients:  dB = (α/r) · (x·A)^T · dy
 *             dA = (α/r) · x^T · (dy·B^T)
 *
 * We expose `applyLoraForward()` for the inference path (cheap matmul + add) and
 * `loraBackward()` for the training path (computes dA / dB given the captured
 * activations from forward).
 */

import { Tensor } from "../model/tensor";
import { matmul } from "../model/ops";

export interface LoraAdapter {
  A: Tensor; // (dIn, rank)
  B: Tensor; // (rank, dOut)
  alpha: number;
  rank: number;
}

/** y' = base + scale · (x · A) · B  — adds the LoRA delta to a pre-computed base output. */
export function applyLoraForward(base: Tensor, x: Tensor, lora: LoraAdapter): Tensor {
  if (lora.rank === 0) return base;
  const xa = matmul(x, lora.A);
  const delta = matmul(xa, lora.B);
  const scale = lora.alpha / lora.rank;
  // base += scale * delta
  for (let i = 0; i < base.size; i++) base.data[i] = (base.data[i] ?? 0) + scale * (delta.data[i] ?? 0);
  return base;
}

/** dA, dB given x (the input to the original linear) and dy (gradient w.r.t. the layer output). */
export function loraBackward(
  x: Tensor,
  lora: LoraAdapter,
  dy: Tensor,
): { dA: Tensor; dB: Tensor } {
  const scale = lora.alpha / lora.rank;
  const xT = transpose2(x);
  // dB = scale * (x · A)^T · dy   (rank, dOut)
  const xa = matmul(x, lora.A);
  const dB = matmul(transpose2(xa), dy);
  scaleInPlace(dB, scale);
  // dA = scale * x^T · (dy · B^T)   (dIn, rank)
  const Bt = transpose2(lora.B);
  const dyB = matmul(dy, Bt);
  const dA = matmul(xT, dyB);
  scaleInPlace(dA, scale);
  return { dA, dB };
}

function transpose2(t: Tensor): Tensor {
  const [m, n] = t.shape as [number, number];
  const out = new Float32Array(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) out[j * m + i] = t.data[i * n + j]!;
  return new Tensor(out, [n, m]);
}

function scaleInPlace(t: Tensor, s: number): void {
  for (let i = 0; i < t.size; i++) t.data[i] = (t.data[i] ?? 0) * s;
}
