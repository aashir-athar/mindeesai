/**
 * AdamW optimizer.
 *
 * Standard parameters from "Decoupled Weight Decay Regularization" (Loshchilov & Hutter 2017).
 *
 * Each parameter gets a tracked (m, v) state.  Update:
 *   m_t = β1·m_{t-1} + (1−β1)·g
 *   v_t = β2·v_{t-1} + (1−β2)·g²
 *   m̂   = m_t / (1−β1^t)
 *   v̂   = v_t / (1−β2^t)
 *   p   ← p − lr·(m̂ / (√v̂ + ε) + λ·p)
 */

import { Tensor } from "../model/tensor";

export interface AdamWConfig {
  lr: number;
  beta1: number;
  beta2: number;
  eps: number;
  weightDecay: number;
}

export const DEFAULT_ADAMW: AdamWConfig = {
  lr: 5e-4,
  beta1: 0.9,
  beta2: 0.95,
  eps: 1e-8,
  weightDecay: 0.01,
};

interface AdamState {
  m: Float32Array;
  v: Float32Array;
  step: number;
}

export class AdamW {
  private state = new WeakMap<Tensor, AdamState>();
  constructor(public cfg: AdamWConfig = DEFAULT_ADAMW) {}

  /** Apply an in-place update to `param` given its accumulated gradient `grad`. */
  step(param: Tensor, grad: Tensor): void {
    let s = this.state.get(param);
    if (!s) {
      s = { m: new Float32Array(param.size), v: new Float32Array(param.size), step: 0 };
      this.state.set(param, s);
    }
    s.step++;
    const { lr, beta1, beta2, eps, weightDecay } = this.cfg;
    const bc1 = 1 - Math.pow(beta1, s.step);
    const bc2 = 1 - Math.pow(beta2, s.step);

    for (let i = 0; i < param.size; i++) {
      const g = grad.data[i] ?? 0;
      s.m[i] = beta1 * (s.m[i] ?? 0) + (1 - beta1) * g;
      s.v[i] = beta2 * (s.v[i] ?? 0) + (1 - beta2) * g * g;
      const mHat = s.m[i]! / bc1;
      const vHat = s.v[i]! / bc2;
      const update = mHat / (Math.sqrt(vHat) + eps) + weightDecay * (param.data[i] ?? 0);
      param.data[i] = (param.data[i] ?? 0) - lr * update;
    }
  }

  /** Reset internal state (e.g. after merging LoRA into base weights). */
  reset(): void {
    this.state = new WeakMap();
  }
}
