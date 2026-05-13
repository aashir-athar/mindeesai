/**
 * Mixture of Experts (MoE) FFN.
 *
 * Design (mirrors DeepSeek-V3 / Mixtral 8×7B):
 *   - A learned router maps each token's hidden state to N expert scores.
 *   - Top-K (= expertsPerToken) experts are activated per token.
 *   - Each expert is a standalone SwiGLU FFN.
 *   - Per-token output is the routing-weighted sum of selected experts' outputs.
 *   - A load-balancing auxiliary loss penalises any expert from being over-used,
 *     keeping the experts specialised rather than collapsing onto one.
 *
 * Why this matters:
 *   For the same per-token compute (2 active experts), the model gets the
 *   *capacity* of 8 dense FFNs. Sparse activation is the trick behind Mixtral,
 *   DeepSeek-V3, Llama 4 Scout, and every recent frontier model.
 */

import { Tensor } from "./tensor";
import { matmul, silu, mul, softmax } from "./ops";
import { applyLoraForward, type LoraAdapter } from "../train/lora";
import type { ModelConfig } from "./config";

export interface ExpertWeights {
  wGate: Tensor;
  wUp: Tensor;
  wDown: Tensor;
  loraGate: LoraAdapter;
  loraUp: LoraAdapter;
  loraDown: LoraAdapter;
}

export interface MoEWeights {
  /** Router projection: (dModel, numExperts) */
  router: Tensor;
  experts: ExpertWeights[];
  loraRouter: LoraAdapter;
}

export function initMoE(cfg: ModelConfig): MoEWeights {
  if (!cfg.useMoE) throw new Error("initMoE called with useMoE=false");
  const experts: ExpertWeights[] = [];
  for (let e = 0; e < cfg.numExperts; e++) {
    experts.push({
      wGate: Tensor.kaiming([cfg.dModel, cfg.dFFN], cfg.dModel),
      wUp: Tensor.kaiming([cfg.dModel, cfg.dFFN], cfg.dModel),
      wDown: Tensor.kaiming([cfg.dFFN, cfg.dModel], cfg.dFFN),
      loraGate: { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dFFN]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
      loraUp:   { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.dFFN]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
      loraDown: { A: Tensor.kaiming([cfg.dFFN, cfg.loraRank], cfg.dFFN),     B: Tensor.zeros([cfg.loraRank, cfg.dModel]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
    });
  }
  return {
    router: Tensor.kaiming([cfg.dModel, cfg.numExperts], cfg.dModel),
    experts,
    loraRouter: { A: Tensor.kaiming([cfg.dModel, cfg.loraRank], cfg.dModel), B: Tensor.zeros([cfg.loraRank, cfg.numExperts]), alpha: cfg.loraAlpha, rank: cfg.loraRank },
  };
}

/**
 * Per-token top-K routing + weighted expert combination.
 *
 * Also returns the load-balancing metric used by the auxiliary loss:
 *   `expertUsage[e]` = mean routing probability assigned to expert `e`.
 *   `expertFraction[e]` = fraction of tokens that selected expert `e` in top-K.
 *
 * The aux loss is: cfg.numExperts · Σ_e expertUsage[e] · expertFraction[e]
 * which is minimised when both distributions are uniform.
 */
export function moeForward(
  x: Tensor,                           // (T, dModel)
  moe: MoEWeights,
  cfg: ModelConfig,
): { y: Tensor; auxLoss: number; expertFraction: Float32Array; expertUsage: Float32Array } {
  const t = x.shape[0]!;
  const d = cfg.dModel;
  const E = cfg.numExperts;
  const K = cfg.expertsPerToken;

  // 1. Router logits: (T, E)
  const routerLogits = applyLoraForward(matmul(x, moe.router), x, moe.loraRouter);

  // 2. Softmax → routing probabilities
  const routingProbs = softmax(routerLogits);

  // 3. Top-K selection per row
  const chosenIdx = new Int32Array(t * K);
  const chosenWeight = new Float32Array(t * K);
  const expertFraction = new Float32Array(E);

  for (let i = 0; i < t; i++) {
    // Heap-free top-K (E is small, typically 8-16)
    const probs: Array<{ e: number; p: number }> = [];
    for (let e = 0; e < E; e++) probs.push({ e, p: routingProbs.data[i * E + e]! });
    probs.sort((a, b) => b.p - a.p);
    // Renormalise the K winners so their weights sum to 1
    let sum = 0;
    for (let k = 0; k < K; k++) sum += probs[k]!.p;
    const inv = sum === 0 ? 0 : 1 / sum;
    for (let k = 0; k < K; k++) {
      chosenIdx[i * K + k] = probs[k]!.e;
      chosenWeight[i * K + k] = probs[k]!.p * inv;
      expertFraction[probs[k]!.e] = (expertFraction[probs[k]!.e] ?? 0) + 1;
    }
  }
  for (let e = 0; e < E; e++) expertFraction[e] = (expertFraction[e] ?? 0) / t;

  // 4. Run each expert on its assigned tokens
  // We group tokens by expert to amortise the matmul cost.
  const assignments: number[][] = Array.from({ length: E }, () => []);
  const assignWeights: number[][] = Array.from({ length: E }, () => []);
  for (let i = 0; i < t; i++) {
    for (let k = 0; k < K; k++) {
      const e = chosenIdx[i * K + k]!;
      assignments[e]!.push(i);
      assignWeights[e]!.push(chosenWeight[i * K + k]!);
    }
  }

  // Accumulator for the output (T, dModel)
  const yBuf = new Float32Array(t * d);

  for (let e = 0; e < E; e++) {
    const idx = assignments[e]!;
    if (idx.length === 0) continue;
    const ws = assignWeights[e]!;
    const expert = moe.experts[e]!;

    // Gather x rows
    const xExpertBuf = new Float32Array(idx.length * d);
    for (let r = 0; r < idx.length; r++) {
      const src = idx[r]! * d;
      for (let p = 0; p < d; p++) xExpertBuf[r * d + p] = x.data[src + p]!;
    }
    const xExpert = new Tensor(xExpertBuf, [idx.length, d]);

    // SwiGLU FFN
    const gate = applyLoraForward(matmul(xExpert, expert.wGate), xExpert, expert.loraGate);
    const up = applyLoraForward(matmul(xExpert, expert.wUp), xExpert, expert.loraUp);
    const intermediate = mul(silu(gate), up);
    const out = applyLoraForward(matmul(intermediate, expert.wDown), intermediate, expert.loraDown);

    // Scatter back into yBuf, weighted
    for (let r = 0; r < idx.length; r++) {
      const w = ws[r]!;
      const dst = idx[r]! * d;
      for (let p = 0; p < d; p++) yBuf[dst + p] = (yBuf[dst + p] ?? 0) + w * out.data[r * d + p]!;
    }
  }

  // 5. Load-balancing auxiliary loss
  // expertUsage[e] = mean of routing probability over tokens for expert e
  const expertUsage = new Float32Array(E);
  for (let i = 0; i < t; i++) {
    for (let e = 0; e < E; e++) expertUsage[e] = (expertUsage[e] ?? 0) + routingProbs.data[i * E + e]!;
  }
  for (let e = 0; e < E; e++) expertUsage[e] = (expertUsage[e] ?? 0) / t;

  let auxLoss = 0;
  for (let e = 0; e < E; e++) auxLoss += (expertUsage[e] ?? 0) * (expertFraction[e] ?? 0);
  auxLoss *= E * cfg.moeLoadBalanceWeight;

  return { y: new Tensor(yBuf, x.shape), auxLoss, expertFraction, expertUsage };
}
