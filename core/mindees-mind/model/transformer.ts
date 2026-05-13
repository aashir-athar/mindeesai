/**
 * The full decoder-only transformer.
 *
 * One pass through `forward()` runs:
 *   tokens → embed → [block × nLayers] → final RMSNorm → LM head → logits
 *
 * Each block is:
 *   x' = x + Attention(RMSNorm(x))
 *   x  = x' + FFN(RMSNorm(x'))
 *
 * (pre-norm residual, the modern standard).
 */

import { Tensor } from "./tensor";
import { rmsNorm } from "./ops";
import { type EmbeddingTable, type FFNWeights, type LMHead, embed, ffnForward, initEmbedding, initFFN, initLMHead, lmHeadForward } from "./layers";
import { type AttentionWeights, type KVCache, attentionForward, initAttention } from "./attention";
import { type ModelConfig, loadConfig, paramCount } from "./config";
import { createLogger } from "@/lib/logger";

const log = createLogger("transformer");

// ─────────────────────────────────────────────────────────────────────────────

export interface Block {
  attnNorm: Tensor; // (dModel,)
  attn: AttentionWeights;
  ffnNorm: Tensor;  // (dModel,)
  ffn: FFNWeights;
}

export interface ModelWeights {
  cfg: ModelConfig;
  embedding: EmbeddingTable;
  blocks: Block[];
  finalNorm: Tensor; // (dModel,)
  lmHead: LMHead;
}

export function initModel(cfg: ModelConfig = loadConfig()): ModelWeights {
  log.info(`initialising ${cfg.variant} (${(paramCount(cfg) / 1e6).toFixed(1)}M params)`);
  const blocks: Block[] = [];
  for (let i = 0; i < cfg.nLayers; i++) {
    blocks.push({
      attnNorm: Tensor.ones([cfg.dModel]),
      attn: initAttention(cfg),
      ffnNorm: Tensor.ones([cfg.dModel]),
      ffn: initFFN(cfg),
    });
  }
  return {
    cfg,
    embedding: initEmbedding(cfg),
    blocks,
    finalNorm: Tensor.ones([cfg.dModel]),
    lmHead: initLMHead(cfg),
  };
}

/**
 * Forward through the entire model.
 *
 * If `caches` is provided, performs incremental decoding: x can be 1 token and
 * each per-block cache is updated. Otherwise, runs full-sequence (training).
 */
export function modelForward(
  model: ModelWeights,
  tokens: Int32Array,
  caches?: KVCache[],
): { logits: Tensor; caches?: KVCache[] } {
  const cfg = model.cfg;
  let x = embed(tokens, model.embedding, cfg.dModel);

  const newCaches: KVCache[] | undefined = caches ? [] : undefined;

  for (let i = 0; i < cfg.nLayers; i++) {
    const block = model.blocks[i]!;
    const cache = caches?.[i];

    const xNormed = rmsNorm(x, block.attnNorm, cfg.rmsNormEps);
    const { y: attnOut, cache: newCache } = attentionForward(xNormed, block.attn, cfg, cache);

    x = addInPlace(x, attnOut);

    const xNormed2 = rmsNorm(x, block.ffnNorm, cfg.rmsNormEps);
    const ffnOut = ffnForward(xNormed2, block.ffn);
    x = addInPlace(x, ffnOut);

    if (newCaches) newCaches.push(newCache!);
  }

  const xFinal = rmsNorm(x, model.finalNorm, cfg.rmsNormEps);
  const logits = lmHeadForward(xFinal, model.lmHead, model.embedding);

  return { logits, caches: newCaches };
}

/** Elementwise add into the first tensor's buffer. Returns the same tensor. */
function addInPlace(a: Tensor, b: Tensor): Tensor {
  if (a.size !== b.size) throw new Error(`add size mismatch ${a.shape} ${b.shape}`);
  for (let i = 0; i < a.size; i++) a.data[i] = (a.data[i] ?? 0) + (b.data[i] ?? 0);
  return a;
}

/** Build empty KV caches for a fresh inference session. */
export function emptyCaches(cfg: ModelConfig): KVCache[] {
  return Array.from({ length: cfg.nLayers }, () => ({
    k: Tensor.zeros([0, cfg.nKVHeads * cfg.dHead]),
    v: Tensor.zeros([0, cfg.nKVHeads * cfg.dHead]),
    position: 0,
  }));
}
