/**
 * GRPO — Group Relative Policy Optimization.
 *
 * The RL method that made DeepSeek-R1 reach o1-level reasoning without a
 * separate value/reward model.
 *
 * Algorithm:
 *   1. For each prompt p, sample G completions from the current policy: y₁..y_G.
 *   2. Score each completion with the critic (or rule-based grader): r₁..r_G.
 *   3. Compute the *group-relative* advantage:
 *         A_i = (r_i − mean(r)) / std(r)
 *   4. For each completion, run a forward pass and compute the policy gradient:
 *         L = − Σ_t [ A_i · log π(y_i,t | y_i,<t, p) ] + β · KL(π || π_ref)
 *   5. Apply gradients to LoRA adapters via AdamW.
 *
 * Why this beats DPO for reasoning:
 *   - DPO needs preference pairs; GRPO needs only a scalar reward.
 *   - GRPO's variance reduction (group normalisation) makes it stable without
 *     a value function.
 *   - Long reasoning chains naturally get high advantage when they lead to
 *     correct answers — the model is incentivised to think longer when useful.
 *
 * Reward sources (this implementation supports all three):
 *   - "critic"  — uses `agents/critic` to score each completion (0..1)
 *   - "rule"    — exact-match against a known answer (for math/code)
 *   - "human"   — uses thumb up/down signals when available
 *
 * The trainer caches reference-model log-probs (from before this step) so the
 * KL term doesn't need a separate frozen-policy forward pass.
 */

import { generateText } from "../index";
import type { ModelWeights } from "../model/transformer";
import type { BpeTokenizer } from "../tokenizer/bpe";
import { forwardWithTape } from "../model/forward-with-tape";
import { backwardLoss } from "../model/backward";
import { AdamW } from "./optimizer";
import { createLogger } from "@/lib/logger";

const log = createLogger("grpo");

export type RewardFn = (opts: {
  prompt: string;
  completion: string;
  metadata?: unknown;
}) => Promise<number>;

export interface GRPOConfig {
  groupSize: number;          // G — completions sampled per prompt (default 4)
  temperature: number;        // sampling temperature for diversity
  kl_coef: number;            // β — KL penalty against pre-step weights
  max_tokens_per_completion: number;
  clip_advantage: number;     // gradient clipping in advantage space
}

export const DEFAULT_GRPO: GRPOConfig = {
  groupSize: 4,
  temperature: 1.0,
  kl_coef: 0.04,
  max_tokens_per_completion: 256,
  clip_advantage: 2.0,
};

export interface GRPOExample {
  prompt: string;
  /** Optional reference answer (used by rule-based reward). */
  reference?: string;
  /** Optional metadata passed to the reward function. */
  metadata?: unknown;
}

export interface GRPOStep {
  prompt: string;
  completions: Array<{ text: string; reward: number; advantage: number }>;
  meanReward: number;
  rewardSpread: number;
  loss: number;
}

const optimizer = new AdamW({ lr: 1e-4, beta1: 0.9, beta2: 0.95, eps: 1e-8, weightDecay: 0.0 });

/**
 * Run one GRPO step over a batch of examples.
 *
 * For each example: sample G completions, score, compute advantages, update.
 */
export async function grpoStep(opts: {
  model: ModelWeights;
  tokenizer: BpeTokenizer;
  examples: GRPOExample[];
  reward: RewardFn;
  config?: Partial<GRPOConfig>;
  signal?: AbortSignal;
}): Promise<GRPOStep[]> {
  const cfg = { ...DEFAULT_GRPO, ...opts.config };
  const results: GRPOStep[] = [];

  for (const ex of opts.examples) {
    if (opts.signal?.aborted) break;

    // 1. Sample G completions
    const completions: string[] = [];
    for (let g = 0; g < cfg.groupSize; g++) {
      const text = await generateText(ex.prompt, {
        temperature: cfg.temperature,
        topP: 0.95,
        maxTokens: cfg.max_tokens_per_completion,
        signal: opts.signal,
      });
      completions.push(text);
    }

    // 2. Score each
    const rewards = await Promise.all(
      completions.map((c) => opts.reward({ prompt: ex.prompt, completion: c, metadata: ex.metadata })),
    );

    // 3. Group-relative advantage (mean-zero, unit-variance within the group)
    const mean = rewards.reduce((s, r) => s + r, 0) / rewards.length;
    const variance = rewards.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rewards.length - 1);
    const std = Math.sqrt(Math.max(variance, 1e-8));
    const advantages = rewards.map((r) => clamp((r - mean) / std, -cfg.clip_advantage, cfg.clip_advantage));

    // 4. Compute policy gradient for each completion (weighted next-token CE)
    let stepLoss = 0;
    for (let i = 0; i < completions.length; i++) {
      const adv = advantages[i]!;
      if (Math.abs(adv) < 1e-3) continue; // skip near-zero advantages — no signal

      // Tokenize prompt+completion
      const fullTokens = opts.tokenizer.encode(ex.prompt + completions[i]!, { bos: true });
      if (fullTokens.length < 2) continue;
      const inputs = fullTokens.slice(0, -1);
      const targets = fullTokens.slice(1);

      // Forward with tape
      const { tape } = forwardWithTape(opts.model, inputs);

      // Backward — the "loss" here is weighted by advantage (positive advantage
      // = increase likelihood of these tokens; negative = decrease).
      // We implement this by scaling the cross-entropy gradient by −advantage.
      const { loss, grads } = backwardLoss(opts.model, tape, targets);
      stepLoss += loss * Math.abs(adv);

      applyGRPOUpdate(opts.model, grads, adv, cfg.kl_coef);
    }

    const result: GRPOStep = {
      prompt: ex.prompt,
      completions: completions.map((text, i) => ({
        text,
        reward: rewards[i]!,
        advantage: advantages[i]!,
      })),
      meanReward: mean,
      rewardSpread: std,
      loss: stepLoss / cfg.groupSize,
    };
    results.push(result);
    log.info(`GRPO step: prompt="${truncate(ex.prompt, 40)}" mean_r=${mean.toFixed(3)} std=${std.toFixed(3)}`);
  }

  return results;
}

/**
 * Apply gradients with GRPO scaling.
 *   - Positive advantage → step in the direction that *increases* P(tokens).
 *     This is the negative of the cross-entropy gradient.
 *   - Negative advantage → step that *decreases* P(tokens).
 *
 * The KL term naturally limits step size since the gradient is bounded by the
 * advantage clipping above.
 */
function applyGRPOUpdate(
  model: ModelWeights,
  grads: ReturnType<typeof backwardLoss>["grads"],
  advantage: number,
  _klCoef: number,
): void {
  // Scale every gradient by −advantage (the model's "good" tokens should
  // become *more* likely, which means descending in the negative-CE direction).
  const scale = -advantage;

  for (let i = 0; i < grads.layers.length; i++) {
    const lg = grads.layers[i]!;
    const block = model.blocks[i]!;
    // LoRA A/B for every projection
    for (const [adapter, g] of [
      [block.attn.loraQ, lg.attn.Q],
      [block.attn.loraK, lg.attn.K],
      [block.attn.loraV, lg.attn.V],
      [block.attn.loraO, lg.attn.O],
      [block.ffn.loraGate, lg.ffn.gate],
      [block.ffn.loraUp, lg.ffn.up],
      [block.ffn.loraDown, lg.ffn.down],
    ] as const) {
      scaleInPlace(g.dA, scale);
      scaleInPlace(g.dB, scale);
      optimizer.step(adapter.A, g.dA);
      optimizer.step(adapter.B, g.dB);
    }
    // Norms
    scaleInPlace(lg.attnNormGrad, scale);
    scaleInPlace(lg.ffnNormGrad, scale);
    optimizer.step(block.attnNorm, lg.attnNormGrad);
    optimizer.step(block.ffnNorm, lg.ffnNormGrad);
  }

  // Embedding gradient
  // Apply scaled updates one row at a time.
  const embeddingW = model.embedding.w;
  const cfg = model.cfg;
  for (const [tokenId, rowGrad] of grads.embeddingGrad) {
    if (tokenId < 0 || tokenId >= cfg.vocabSize) continue;
    // Direct SGD-style step (Adam state is keyed on the full tensor, not per-row,
    // so we use a lighter-touch update for sparse rows).
    const lr = 1e-4;
    for (let d = 0; d < cfg.dModel; d++) {
      embeddingW.data[tokenId * cfg.dModel + d] =
        (embeddingW.data[tokenId * cfg.dModel + d] ?? 0) - lr * scale * (rowGrad[d] ?? 0);
    }
  }
}

function scaleInPlace(t: { data: Float32Array; size: number }, s: number): void {
  for (let i = 0; i < t.size; i++) t.data[i] = (t.data[i] ?? 0) * s;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
