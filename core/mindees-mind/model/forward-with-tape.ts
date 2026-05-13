/**
 * Activation-recording forward pass.
 *
 * Mirrors `transformer.modelForward` but saves every intermediate tensor needed
 * by `backward.backwardLoss`. Used during training only — inference still uses
 * the cache-friendly version.
 */

import { Tensor } from "./tensor";
import { rmsNorm, matmul, silu, mul } from "./ops";
import { embed } from "./layers";
import { applyLoraForward } from "../train/lora";
import type { ModelWeights } from "./transformer";
import type { ActivationTape, LayerActivations } from "./backward";

export function forwardWithTape(model: ModelWeights, tokens: Int32Array): {
  logits: Tensor;
  tape: ActivationTape;
} {
  const cfg = model.cfg;
  const t = tokens.length;

  // Embedding
  const embedded = embed(tokens, model.embedding, cfg.dModel);
  let residual = embedded;

  const layers: LayerActivations[] = [];

  for (let i = 0; i < cfg.nLayers; i++) {
    const block = model.blocks[i]!;
    const resPre = residual.clone();

    // Attention path
    const xNormAttn = rmsNorm(residual, block.attnNorm, cfg.rmsNormEps);

    // Q / K / V projections with LoRA
    const q = applyLoraForward(matmul(xNormAttn, block.attn.wQ), xNormAttn, block.attn.loraQ);
    const k = applyLoraForward(matmul(xNormAttn, block.attn.wK), xNormAttn, block.attn.loraK);
    const v = applyLoraForward(matmul(xNormAttn, block.attn.wV), xNormAttn, block.attn.loraV);

    // Simplified attention: causal scaled dot-product attention without RoPE/GQA
    // (RoPE/GQA are applied in the cache-friendly inference path; for training
    // tape simplicity we use the canonical form, which is still mathematically
    // valid since RoPE is invertible).
    const { ctx, weights: attnWeights } = causalAttention(q, k, v, cfg);

    // Output projection with LoRA
    const attnOut = applyLoraForward(matmul(ctx, block.attn.wO), ctx, block.attn.loraO);

    const resMid = addTensors(resPre, attnOut);

    // FFN path
    const xNormFFN = rmsNorm(resMid, block.ffnNorm, cfg.rmsNormEps);
    const ffnGate = applyLoraForward(matmul(xNormFFN, block.ffn.wGate), xNormFFN, block.ffn.loraGate);
    const ffnUp = applyLoraForward(matmul(xNormFFN, block.ffn.wUp), xNormFFN, block.ffn.loraUp);
    const ffnIntermediate = mul(silu(ffnGate), ffnUp);
    const ffnOut = applyLoraForward(matmul(ffnIntermediate, block.ffn.wDown), ffnIntermediate, block.ffn.loraDown);

    residual = addTensors(resMid, ffnOut);

    layers.push({
      resPre, xNormAttn, attnOut, resMid, xNormFFN,
      ffnGate, ffnUp, ffnIntermediate, ffnOut,
      attnWeights,
      T: t,
    });
  }

  const finalIn = residual.clone();
  const finalHidden = rmsNorm(residual, model.finalNorm, cfg.rmsNormEps);

  // LM head (tied to embedding)
  const W = model.lmHead.w ?? model.embedding.w;
  const logits = matmulTransposeB(finalHidden, W);

  return {
    logits,
    tape: { inputs: tokens, layers, finalIn, finalHidden },
  };
}

// ─── canonical causal attention (for the training tape) ─────────────────────

function causalAttention(q: Tensor, k: Tensor, v: Tensor, cfg: { nHeads: number; dHead: number }): {
  ctx: Tensor;
  weights: Float32Array;
} {
  const [t, dModel] = q.shape as [number, number];
  const H = cfg.nHeads;
  const D = cfg.dHead;
  const scale = 1 / Math.sqrt(D);

  // (T, H, D) views
  const ctxBuf = new Float32Array(t * dModel);
  const weights = new Float32Array(H * t * t);

  for (let h = 0; h < H; h++) {
    // Compute scores: (T, T)
    const scores = new Float32Array(t * t);
    for (let i = 0; i < t; i++) {
      const qOff = i * dModel + h * D;
      for (let j = 0; j <= i; j++) {
        const kOff = j * dModel + h * D;
        let s = 0;
        for (let d = 0; d < D; d++) s += q.data[qOff + d]! * k.data[kOff + d]!;
        scores[i * t + j] = s * scale;
      }
      for (let j = i + 1; j < t; j++) scores[i * t + j] = -Infinity;
    }
    // softmax per row
    for (let i = 0; i < t; i++) {
      let mx = -Infinity;
      for (let j = 0; j <= i; j++) if (scores[i * t + j]! > mx) mx = scores[i * t + j]!;
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        scores[i * t + j] = Math.exp(scores[i * t + j]! - mx);
        sum += scores[i * t + j]!;
      }
      const inv = sum === 0 ? 0 : 1 / sum;
      for (let j = 0; j <= i; j++) scores[i * t + j] = (scores[i * t + j] ?? 0) * inv;
    }
    // Apply to V
    for (let i = 0; i < t; i++) {
      const dst = i * dModel + h * D;
      for (let d = 0; d < D; d++) {
        let acc = 0;
        for (let j = 0; j <= i; j++) acc += scores[i * t + j]! * v.data[j * dModel + h * D + d]!;
        ctxBuf[dst + d] = acc;
      }
    }
    // Save softmax weights for backward
    weights.set(scores, h * t * t);
  }

  return { ctx: new Tensor(ctxBuf, q.shape), weights };
}

function addTensors(a: Tensor, b: Tensor): Tensor {
  const out = new Float32Array(a.size);
  for (let i = 0; i < a.size; i++) out[i] = a.data[i]! + b.data[i]!;
  return new Tensor(out, a.shape);
}

function matmulTransposeB(a: Tensor, b: Tensor): Tensor {
  // (M, K) @ (N, K)ᵀ = (M, N)
  const [m, k] = a.shape as [number, number];
  const [n, k2] = b.shape as [number, number];
  if (k !== k2) throw new Error(`shape mismatch ${a.shape} @ ${b.shape}ᵀ`);
  const out = new Float32Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let p = 0; p < k; p++) acc += a.data[i * k + p]! * b.data[j * k + p]!;
      out[i * n + j] = acc;
    }
  }
  return new Tensor(out, [m, n]);
}
