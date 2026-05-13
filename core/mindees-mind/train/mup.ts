/**
 * µP (Maximal Update Parameterization) — Yang & Hu, 2021.
 *
 * The promise: tune hyperparameters (learning rate, init scale) on a small
 * width model, scale to a large width without retuning. Without µP, the
 * optimal LR shifts as width grows; with µP it's invariant.
 *
 * Implementation:
 *   - Initialise every linear layer with σ ∝ 1 / √fanIn  (already the case
 *     via Kaiming init).
 *   - Scale the *learning rate* of every "hidden" linear by 1 / width_factor.
 *   - Leave embedding + LM head at the base learning rate.
 *
 * `width_factor` = current_dModel / base_dModel  (base_dModel is the width
 * the hyperparameters were tuned at — we use the `nano` config's dModel).
 *
 * To activate, the optimiser checks each parameter's metadata and applies the
 * appropriate scale. This file owns that metadata.
 */

import type { ModelConfig } from "../model/config";

export const MUP_BASE_DMODEL = 256; // matches the `nano` variant

export function widthFactor(cfg: ModelConfig): number {
  return cfg.dModel / MUP_BASE_DMODEL;
}

export interface MupScale {
  /** Per-parameter LR multiplier. */
  lr: number;
  /** Per-parameter init scale multiplier (already baked into Kaiming init). */
  init: number;
}

/**
 * Return the µP scale for a parameter, identified by its role.
 *
 * Roles:
 *   "embedding"  — token embedding table   (no LR scaling)
 *   "lm_head"    — final projection         (no LR scaling)
 *   "norm"       — RMSNorm gain              (no LR scaling)
 *   "hidden"     — every other linear        (LR scaled by 1/widthFactor)
 */
export function mupScaleFor(role: "embedding" | "lm_head" | "norm" | "hidden", cfg: ModelConfig): MupScale {
  if (!cfg.useMuP) return { lr: 1, init: 1 };
  switch (role) {
    case "embedding":
    case "lm_head":
    case "norm":
      return { lr: 1, init: 1 };
    case "hidden":
      return { lr: 1 / widthFactor(cfg), init: 1 };
  }
}
