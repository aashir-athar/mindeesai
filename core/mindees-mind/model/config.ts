/**
 * MindeesAI native model — architecture hyperparameters.
 *
 * 2026 frontier features (all toggleable per-variant):
 *   - useMoE       — Mixture of Experts FFN (top-2 routing, load balancing loss)
 *   - useMLA       — Multi-head Latent Attention (compressed KV cache, DeepSeek-V3)
 *   - useMTP       — Multi-Token Prediction auxiliary heads (DeepSeek-V3)
 *   - useMuP       — µP scaling: width-invariant init + LR
 *
 * Variant is environment-driven:
 *   MIND_VARIANT=nano|small|base|large|moe-small|moe-base    (default: small)
 */

export type ModelVariant =
  | "nano"
  | "small"
  | "base"
  | "large"
  | "moe-small"
  | "moe-base";

export interface ModelConfig {
  variant: ModelVariant;
  vocabSize: number;
  contextLength: number;
  dModel: number;
  nLayers: number;
  nHeads: number;
  nKVHeads: number;
  dHead: number;
  dFFN: number;
  ropeBase: number;
  rmsNormEps: number;
  tieEmbeddings: boolean;
  loraRank: number;
  loraAlpha: number;

  // ── frontier features ──
  /** Mixture of Experts: replace dense FFN with sparse experts. */
  useMoE: boolean;
  numExperts: number;          // total experts per MoE layer
  expertsPerToken: number;     // active experts (top-k)
  moeLoadBalanceWeight: number;

  /** Multi-head Latent Attention (DeepSeek-V3) — compresses K/V into a low-rank latent. */
  useMLA: boolean;
  mlaLatentDim: number;        // typical: dModel / 4

  /** Multi-Token Prediction (DeepSeek-V3) — predict next-k tokens for training signal. */
  useMTP: boolean;
  mtpDepth: number;            // 1 = vanilla LM; 2..4 = multi-token

  /** µP scaling — set true to get width-invariant init + lr at this width. */
  useMuP: boolean;

  /** Reasoning capability: model can emit `<think>...</think>` blocks. */
  useReasoning: boolean;
  reasoningMaxTokens: number;
}

const TABLE: Record<ModelVariant, Omit<ModelConfig, "variant" | "dHead">> = {
  nano: {
    vocabSize: 16_000, contextLength: 1024, dModel: 256, nLayers: 6,
    nHeads: 4, nKVHeads: 4, dFFN: 768,
    ropeBase: 10000, rmsNormEps: 1e-6, tieEmbeddings: true,
    loraRank: 8, loraAlpha: 16,
    useMoE: false, numExperts: 1, expertsPerToken: 1, moeLoadBalanceWeight: 0.01,
    useMLA: false, mlaLatentDim: 64,
    useMTP: false, mtpDepth: 1,
    useMuP: true,
    useReasoning: false, reasoningMaxTokens: 256,
  },
  small: {
    vocabSize: 32_000, contextLength: 2048, dModel: 512, nLayers: 8,
    nHeads: 8, nKVHeads: 4, dFFN: 1536,
    ropeBase: 10000, rmsNormEps: 1e-6, tieEmbeddings: true,
    loraRank: 8, loraAlpha: 16,
    useMoE: false, numExperts: 1, expertsPerToken: 1, moeLoadBalanceWeight: 0.01,
    useMLA: true, mlaLatentDim: 128,
    useMTP: true, mtpDepth: 2,
    useMuP: true,
    useReasoning: true, reasoningMaxTokens: 512,
  },
  base: {
    vocabSize: 50_000, contextLength: 4096, dModel: 1024, nLayers: 12,
    nHeads: 16, nKVHeads: 8, dFFN: 2816,
    ropeBase: 500000, rmsNormEps: 1e-6, tieEmbeddings: true,
    loraRank: 16, loraAlpha: 32,
    useMoE: false, numExperts: 1, expertsPerToken: 1, moeLoadBalanceWeight: 0.01,
    useMLA: true, mlaLatentDim: 256,
    useMTP: true, mtpDepth: 2,
    useMuP: true,
    useReasoning: true, reasoningMaxTokens: 1024,
  },
  large: {
    vocabSize: 64_000, contextLength: 8192, dModel: 2048, nLayers: 24,
    nHeads: 32, nKVHeads: 8, dFFN: 5632,
    ropeBase: 500000, rmsNormEps: 1e-6, tieEmbeddings: true,
    loraRank: 16, loraAlpha: 32,
    useMoE: false, numExperts: 1, expertsPerToken: 1, moeLoadBalanceWeight: 0.01,
    useMLA: true, mlaLatentDim: 512,
    useMTP: true, mtpDepth: 3,
    useMuP: true,
    useReasoning: true, reasoningMaxTokens: 2048,
  },
  "moe-small": {
    vocabSize: 32_000, contextLength: 2048, dModel: 512, nLayers: 8,
    nHeads: 8, nKVHeads: 4, dFFN: 1024,        // smaller dense-FFN; experts make up capacity
    ropeBase: 10000, rmsNormEps: 1e-6, tieEmbeddings: true,
    loraRank: 8, loraAlpha: 16,
    useMoE: true, numExperts: 8, expertsPerToken: 2, moeLoadBalanceWeight: 0.01,
    useMLA: true, mlaLatentDim: 128,
    useMTP: true, mtpDepth: 2,
    useMuP: true,
    useReasoning: true, reasoningMaxTokens: 512,
  },
  "moe-base": {
    vocabSize: 50_000, contextLength: 4096, dModel: 1024, nLayers: 12,
    nHeads: 16, nKVHeads: 8, dFFN: 1408,
    ropeBase: 500000, rmsNormEps: 1e-6, tieEmbeddings: true,
    loraRank: 16, loraAlpha: 32,
    useMoE: true, numExperts: 16, expertsPerToken: 2, moeLoadBalanceWeight: 0.01,
    useMLA: true, mlaLatentDim: 256,
    useMTP: true, mtpDepth: 2,
    useMuP: true,
    useReasoning: true, reasoningMaxTokens: 1024,
  },
};

export function loadConfig(variant?: ModelVariant): ModelConfig {
  const v = (variant ?? (process.env.MIND_VARIANT as ModelVariant) ?? "small") as ModelVariant;
  if (!(v in TABLE)) throw new Error(`unknown MIND_VARIANT: ${v}`);
  const base = TABLE[v];
  return { variant: v, ...base, dHead: base.dModel / base.nHeads };
}

/** Total parameter count — includes experts when MoE is on. */
export function paramCount(cfg: ModelConfig): number {
  const embedding = cfg.vocabSize * cfg.dModel;
  const finalNorm = cfg.dModel;
  const lmHead = cfg.tieEmbeddings ? 0 : cfg.vocabSize * cfg.dModel;

  // Per-layer attention parameters
  let attn: number;
  if (cfg.useMLA) {
    // MLA: Q + KV-compressed (latent) + KV-decompressed + O
    attn =
      cfg.dModel * cfg.dModel +                              // Q
      cfg.dModel * cfg.mlaLatentDim +                        // KV down-projection
      cfg.mlaLatentDim * (cfg.nKVHeads * cfg.dHead) +        // K up-projection
      cfg.mlaLatentDim * (cfg.nKVHeads * cfg.dHead) +        // V up-projection
      cfg.dModel * cfg.dModel;                               // O
  } else {
    const kvDim = cfg.nKVHeads * cfg.dHead;
    attn = cfg.dModel * cfg.dModel + 2 * cfg.dModel * kvDim + cfg.dModel * cfg.dModel;
  }

  // Per-layer FFN parameters
  let ffn: number;
  if (cfg.useMoE) {
    // Router + N experts each with SwiGLU
    const expertParams = 3 * cfg.dModel * cfg.dFFN;
    ffn = cfg.dModel * cfg.numExperts + expertParams * cfg.numExperts;
  } else {
    ffn = 3 * cfg.dModel * cfg.dFFN;
  }

  const norms = 2 * cfg.dModel;
  const perLayer = attn + ffn + norms;

  // MTP heads add extra parameters
  const mtpExtra = cfg.useMTP && cfg.mtpDepth > 1 ? (cfg.mtpDepth - 1) * (cfg.dModel * cfg.dModel + cfg.dModel) : 0;

  return embedding + perLayer * cfg.nLayers + finalNorm + lmHead + mtpExtra;
}

/** Number of *active* (per-token) parameters — what actually runs at inference. */
export function activeParams(cfg: ModelConfig): number {
  if (!cfg.useMoE) return paramCount(cfg);
  // For MoE, only `expertsPerToken` of `numExperts` are active per token.
  const total = paramCount(cfg);
  const ffnDense = 3 * cfg.dModel * cfg.dFFN;
  const ffnInactive = ffnDense * (cfg.numExperts - cfg.expertsPerToken);
  return total - ffnInactive * cfg.nLayers;
}
