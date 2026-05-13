/**
 * Token embedding, SwiGLU FFN, final LM head.
 */

import { Tensor } from "./tensor";
import { matmul, mul, silu } from "./ops";
import { applyLoraForward, type LoraAdapter } from "../train/lora";
import type { ModelConfig } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// Token embedding
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingTable {
  w: Tensor; // (vocabSize, dModel)
}

export function embed(tokens: Int32Array, table: EmbeddingTable, dModel: number): Tensor {
  const t = tokens.length;
  const out = new Float32Array(t * dModel);
  for (let i = 0; i < t; i++) {
    const tok = tokens[i]!;
    const base = tok * dModel;
    for (let d = 0; d < dModel; d++) out[i * dModel + d] = table.w.data[base + d]!;
  }
  return new Tensor(out, [t, dModel]);
}

export function initEmbedding(cfg: ModelConfig): EmbeddingTable {
  // Small uniform init for embedding tables.
  return { w: Tensor.uniform([cfg.vocabSize, cfg.dModel], 0.02) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SwiGLU FFN
// ─────────────────────────────────────────────────────────────────────────────

export interface FFNWeights {
  wGate: Tensor; // (dModel, dFFN)
  wUp: Tensor;   // (dModel, dFFN)
  wDown: Tensor; // (dFFN, dModel)
  loraGate: LoraAdapter;
  loraUp: LoraAdapter;
  loraDown: LoraAdapter;
}

export function ffnForward(x: Tensor, w: FFNWeights): Tensor {
  // SwiGLU:  silu(x @ wGate) * (x @ wUp)  →  @ wDown
  const gate = applyLoraForward(matmul(x, w.wGate), x, w.loraGate);
  const up = applyLoraForward(matmul(x, w.wUp), x, w.loraUp);
  const activated = mul(silu(gate), up);
  const out = applyLoraForward(matmul(activated, w.wDown), activated, w.loraDown);
  return out;
}

export function initFFN(cfg: ModelConfig): FFNWeights {
  return {
    wGate: Tensor.kaiming([cfg.dModel, cfg.dFFN], cfg.dModel),
    wUp: Tensor.kaiming([cfg.dModel, cfg.dFFN], cfg.dModel),
    wDown: Tensor.kaiming([cfg.dFFN, cfg.dModel], cfg.dFFN),
    loraGate: { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dFFN]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraUp: { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dFFN]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    loraDown: { A: Tensor.kaiming([cfg.dFFN, cfg.loraRank], cfg.dFFN), B: Tensor.zeros([cfg.loraRank, cfg.dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LM head — projects final hidden state to vocab logits.
// Tied to the embedding table when cfg.tieEmbeddings = true.
// ─────────────────────────────────────────────────────────────────────────────

export interface LMHead {
  w: Tensor | null; // null when tied to embedding table
}

export function lmHeadForward(x: Tensor, head: LMHead, embedding: EmbeddingTable): Tensor {
  const weight = head.w ?? embedding.w;
  // x: (T, dModel)   weight: (vocab, dModel)   → logits (T, vocab) via matmul(x, weight.T)
  const [t, d] = x.shape as [number, number];
  const [vocab, d2] = weight.shape as [number, number];
  if (d !== d2) throw new Error(`lm-head dim mismatch: x=${x.shape} w=${weight.shape}`);
  const out = new Float32Array(t * vocab);
  for (let i = 0; i < t; i++) {
    for (let v = 0; v < vocab; v++) {
      let acc = 0;
      const wBase = v * d;
      for (let p = 0; p < d; p++) acc += x.data[i * d + p]! * weight.data[wBase + p]!;
      out[i * vocab + v] = acc;
    }
  }
  return new Tensor(out, [t, vocab]);
}

export function initLMHead(cfg: ModelConfig): LMHead {
  if (cfg.tieEmbeddings) return { w: null };
  return { w: Tensor.kaiming([cfg.vocabSize, cfg.dModel], cfg.dModel) };
}
