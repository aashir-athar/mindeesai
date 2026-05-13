/**
 * Loss functions used by the online training loop.
 */

import type { Tensor } from "../model/tensor";
import { crossEntropy } from "../model/ops";

/** Standard next-token cross-entropy. Returns scalar + gradient on logits. */
export function nextTokenLoss(logits: Tensor, targets: Int32Array): { loss: number; dLogits: Tensor } {
  return crossEntropy(logits, targets);
}

/**
 * DPO (Direct Preference Optimisation) loss.
 *
 *   L_DPO = −log σ( β · ( log π(y_w | x) − log π(y_l | x)
 *                       − log π_ref(y_w | x) + log π_ref(y_l | x) ) )
 *
 * In practice for online learning we approximate with the *current* model serving
 * as its own reference (no separate frozen π_ref). This is "DPO-implicit" — works
 * well for small preference batches.
 *
 * Returns the scalar loss and the per-token gradient signal that should be
 * scaled into the chosen/rejected next-token cross-entropy.
 */
export function dpoLossSignal(opts: {
  chosenLogProbSum: number;
  rejectedLogProbSum: number;
  beta?: number;
}): { loss: number; chosenWeight: number; rejectedWeight: number } {
  const beta = opts.beta ?? 0.1;
  const margin = beta * (opts.chosenLogProbSum - opts.rejectedLogProbSum);
  // σ(−margin) — gradient signal scales with how *wrong* the preference is.
  const sigmoid = 1 / (1 + Math.exp(margin));
  const loss = -Math.log(1 - sigmoid + 1e-12);
  // The gradient with respect to logπ(chosen) is +β·σ(−margin); for rejected it's −β·σ(−margin).
  return {
    loss,
    chosenWeight: beta * sigmoid,
    rejectedWeight: -beta * sigmoid,
  };
}

/** KL(p ∥ q) over softmax distributions — used for self-distillation. */
export function klSoftmax(p: Tensor, q: Tensor): number {
  if (p.size !== q.size) throw new Error("kl size mismatch");
  let kl = 0;
  const t = p.shape[0]!;
  const v = p.shape[1]!;
  for (let i = 0; i < t; i++) {
    let maxP = -Infinity;
    let maxQ = -Infinity;
    for (let c = 0; c < v; c++) {
      if (p.data[i * v + c]! > maxP) maxP = p.data[i * v + c]!;
      if (q.data[i * v + c]! > maxQ) maxQ = q.data[i * v + c]!;
    }
    let sumP = 0;
    let sumQ = 0;
    for (let c = 0; c < v; c++) {
      sumP += Math.exp(p.data[i * v + c]! - maxP);
      sumQ += Math.exp(q.data[i * v + c]! - maxQ);
    }
    const logZp = Math.log(sumP) + maxP;
    const logZq = Math.log(sumQ) + maxQ;
    for (let c = 0; c < v; c++) {
      const lpC = p.data[i * v + c]! - logZp;
      const lqC = q.data[i * v + c]! - logZq;
      const pC = Math.exp(lpC);
      kl += pC * (lpC - lqC);
    }
  }
  return kl / t;
}
