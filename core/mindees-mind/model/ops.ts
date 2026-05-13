/**
 * Forward + backward kernels.
 *
 * Everything here is a pure function over Tensors. No state. No allocation
 * outside the result Tensor. The CPU implementations are reference-grade —
 * correct, deterministic, and slow. The WebGPU runtime (runtime/webgpu.ts)
 * shadows these with WGSL kernels when available.
 *
 * Convention:
 *   - All inputs are read-only
 *   - Outputs allocate a new Tensor
 *   - `*Backward` returns gradients matching the order of its forward inputs
 */

import { Tensor } from "./tensor";

// ─────────────────────────────────────────────────────────────────────────────
// matmul: (M, K) @ (K, N) → (M, N)
// ─────────────────────────────────────────────────────────────────────────────

export function matmul(a: Tensor, b: Tensor): Tensor {
  const [m, k] = a.shape as [number, number];
  const [k2, n] = b.shape as [number, number];
  if (k !== k2) throw new Error(`matmul shape mismatch: ${a.shape} @ ${b.shape}`);

  const out = new Float32Array(m * n);
  const A = a.data;
  const B = b.data;
  // Naive triple loop. WebGPU shader shadows this.
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let p = 0; p < k; p++) acc += A[i * k + p]! * B[p * n + j]!;
      out[i * n + j] = acc;
    }
  }
  return new Tensor(out, [m, n]);
}

/**
 * Gradient of matmul.  y = A @ B
 *   dA = dy @ B^T
 *   dB = A^T @ dy
 */
export function matmulBackward(a: Tensor, b: Tensor, dy: Tensor): { dA: Tensor; dB: Tensor } {
  return {
    dA: matmul(dy, transpose(b)),
    dB: matmul(transpose(a), dy),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// transpose for 2D — used by the matmul backward
// ─────────────────────────────────────────────────────────────────────────────

export function transpose(t: Tensor): Tensor {
  const [m, n] = t.shape as [number, number];
  const out = new Float32Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) out[j * m + i] = t.data[i * n + j]!;
  }
  return new Tensor(out, [n, m]);
}

// ─────────────────────────────────────────────────────────────────────────────
// RMSNorm — used in Llama-style architectures, faster and more stable than LayerNorm
// ─────────────────────────────────────────────────────────────────────────────

export function rmsNorm(x: Tensor, weight: Tensor, eps: number): Tensor {
  const [rows, cols] = expand2(x);
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    let ss = 0;
    for (let c = 0; c < cols; c++) {
      const v = x.data[r * cols + c]!;
      ss += v * v;
    }
    const scale = 1 / Math.sqrt(ss / cols + eps);
    for (let c = 0; c < cols; c++) {
      out[r * cols + c] = x.data[r * cols + c]! * scale * weight.data[c]!;
    }
  }
  return new Tensor(out, x.shape);
}

/** Backward through RMSNorm. Closed-form, vectorised per-row. */
export function rmsNormBackward(
  x: Tensor,
  weight: Tensor,
  dy: Tensor,
  eps: number,
): { dX: Tensor; dW: Tensor } {
  const [rows, cols] = expand2(x);
  const dX = new Float32Array(rows * cols);
  const dW = new Float32Array(cols);

  for (let r = 0; r < rows; r++) {
    let ss = 0;
    for (let c = 0; c < cols; c++) {
      const v = x.data[r * cols + c]!;
      ss += v * v;
    }
    const meanSq = ss / cols;
    const invRms = 1 / Math.sqrt(meanSq + eps);

    let dot = 0;
    for (let c = 0; c < cols; c++) {
      dot += dy.data[r * cols + c]! * weight.data[c]! * x.data[r * cols + c]!;
    }

    for (let c = 0; c < cols; c++) {
      const xi = x.data[r * cols + c]!;
      const dyi = dy.data[r * cols + c]!;
      const wi = weight.data[c]!;
      dX[r * cols + c] = wi * invRms * dyi - (xi * invRms * invRms * invRms * dot) / cols;
      dW[c] = (dW[c] ?? 0) + dyi * xi * invRms;
    }
  }
  return { dX: new Tensor(dX, x.shape), dW: new Tensor(dW, weight.shape) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SiLU + SwiGLU
// ─────────────────────────────────────────────────────────────────────────────

export function silu(x: Tensor): Tensor {
  const out = new Float32Array(x.size);
  for (let i = 0; i < x.size; i++) {
    const v = x.data[i]!;
    out[i] = v / (1 + Math.exp(-v));
  }
  return new Tensor(out, x.shape);
}

/** Elementwise multiply — used in SwiGLU's gate × up step. */
export function mul(a: Tensor, b: Tensor): Tensor {
  if (a.size !== b.size) throw new Error("mul size mismatch");
  const out = new Float32Array(a.size);
  for (let i = 0; i < a.size; i++) out[i] = a.data[i]! * b.data[i]!;
  return new Tensor(out, a.shape);
}

// ─────────────────────────────────────────────────────────────────────────────
// Softmax — causal-masked variant for attention
// ─────────────────────────────────────────────────────────────────────────────

/** Softmax along the last dim, with optional causal mask (i >= j). */
export function softmax(x: Tensor, causal = false): Tensor {
  // shape: (... , T, T) — last two dims interpreted as a square matrix
  const t = x.shape[x.shape.length - 1]!;
  const head = x.shape.slice(0, -1).reduce((a, b) => a * b, 1) / t;
  const out = new Float32Array(x.size);

  for (let h = 0; h < head; h++) {
    for (let row = 0; row < t; row++) {
      const base = (h * t + row) * t;
      let maxV = -Infinity;
      for (let col = 0; col < t; col++) {
        if (causal && col > row) continue;
        if (x.data[base + col]! > maxV) maxV = x.data[base + col]!;
      }
      let sum = 0;
      for (let col = 0; col < t; col++) {
        if (causal && col > row) {
          out[base + col] = 0;
          continue;
        }
        out[base + col] = Math.exp(x.data[base + col]! - maxV);
        sum += out[base + col]!;
      }
      const inv = 1 / sum;
      for (let col = 0; col < t; col++) out[base + col] = (out[base + col] ?? 0) * inv;
    }
  }
  return new Tensor(out, x.shape);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-entropy loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard next-token cross-entropy.
 *   logits: (T, V)
 *   targets: Int32Array of length T
 * Returns:
 *   mean negative log-likelihood, plus gradient on logits.
 */
export function crossEntropy(
  logits: Tensor,
  targets: Int32Array,
): { loss: number; dLogits: Tensor } {
  const [t, v] = logits.shape as [number, number];
  if (targets.length !== t) throw new Error("targets length mismatch");
  const dLogits = new Float32Array(t * v);
  let totalLoss = 0;
  for (let i = 0; i < t; i++) {
    let maxV = -Infinity;
    for (let c = 0; c < v; c++) {
      if (logits.data[i * v + c]! > maxV) maxV = logits.data[i * v + c]!;
    }
    let sumExp = 0;
    for (let c = 0; c < v; c++) sumExp += Math.exp(logits.data[i * v + c]! - maxV);
    const logSumExp = Math.log(sumExp) + maxV;
    const target = targets[i]!;
    totalLoss += logSumExp - logits.data[i * v + target]!;

    // Gradient: softmax(logits) − one_hot(target)
    for (let c = 0; c < v; c++) {
      const p = Math.exp(logits.data[i * v + c]! - logSumExp);
      dLogits[i * v + c] = (p - (c === target ? 1 : 0)) / t;
    }
  }
  return { loss: totalLoss / t, dLogits: new Tensor(dLogits, logits.shape) };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function expand2(t: Tensor): [number, number] {
  // For 1D vectors we treat as (1, N). For higher-rank, last dim is "cols".
  if (t.rank === 1) return [1, t.shape[0]!];
  const cols = t.shape[t.rank - 1]!;
  const rows = t.size / cols;
  return [rows, cols];
}
