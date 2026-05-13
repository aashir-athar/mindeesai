/**
 * Native checkpoint loader.
 *
 * Reads the binary format that `scripts/train/pretrain.py` writes via
 * `save_ts_checkpoint()` and overlays the trained weights onto the
 * randomly-initialised model in-place. After this runs, the TS runtime
 * is genuinely serving inferences from learned weights, not from noise.
 *
 * Binary format (little-endian):
 *
 *   MAGIC[4]           = "MIND"
 *   cfg_json_len[u32]  cfg_json[u8 × len]      (training-time config)
 *   n_tensors[u32]
 *   for each tensor:
 *     name_len[u16]    name[u8 × len]
 *     shape_len[u8]    shape[u32 × N]
 *     data[f32 × prod(shape)]
 *
 * If the file is missing, we no-op and the runtime keeps random weights.
 * If the magic doesn't match, we log and bail (no partial corruption).
 * If a tensor name in the file doesn't exist in the model, we skip it
 * with a warning — this lets a checkpoint from a slightly different
 * architecture variant still load its overlapping tensors.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkpointPath } from "@/lib/paths";
import type { ModelWeights } from "./transformer";
import { Tensor } from "./tensor";
import { createLogger } from "@/lib/logger";

const log = createLogger("checkpoint-loader");

const MAGIC = new Uint8Array([0x4d, 0x49, 0x4e, 0x44]); // "MIND"

export interface LoadResult {
  loaded: boolean;
  path: string;
  format_version: 1;
  tensors_loaded: number;
  tensors_skipped: number;
  trained_config?: Record<string, unknown>;
  reason?: string;
}

/**
 * Attempt to load the native checkpoint into the given model.
 * Returns a structured report; never throws.
 */
export async function loadNativeCheckpoint(
  model: ModelWeights,
  filePath?: string,
): Promise<LoadResult> {
  const target = filePath ?? checkpointPath("base.bin");

  let buf: Buffer;
  try {
    buf = Buffer.from(await readFile(target));
  } catch {
    return {
      loaded: false,
      path: target,
      format_version: 1,
      tensors_loaded: 0,
      tensors_skipped: 0,
      reason: "no checkpoint file",
    };
  }

  // Magic
  if (buf.length < 4 || !arraysEqual(buf.subarray(0, 4), MAGIC)) {
    log.warn(`checkpoint at ${target} has bad magic — refusing to load`);
    return { loaded: false, path: target, format_version: 1, tensors_loaded: 0, tensors_skipped: 0, reason: "bad magic" };
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 4;

  // Config JSON header
  const cfgLen = dv.getUint32(off, true); off += 4;
  let trainedConfig: Record<string, unknown> | undefined;
  if (cfgLen > 0 && cfgLen < 1_000_000) {
    try {
      const cfgJson = new TextDecoder("utf-8").decode(buf.subarray(off, off + cfgLen));
      trainedConfig = JSON.parse(cfgJson) as Record<string, unknown>;
    } catch (e) {
      log.warn("checkpoint config JSON malformed; continuing without it", e);
    }
    off += cfgLen;
  }

  // Architecture sanity check — names need to match so we don't load a
  // 'large' checkpoint into a 'nano' runtime (would silently corrupt).
  if (trainedConfig) {
    const trainedVariant = trainedConfig.variant as string | undefined;
    if (trainedVariant && trainedVariant !== model.cfg.variant) {
      log.warn(
        `checkpoint variant=${trainedVariant} but runtime MIND_VARIANT=${model.cfg.variant}. ` +
        `Loading will best-effort by shape — set MIND_VARIANT=${trainedVariant} to align.`,
      );
    }
  }

  const nTensors = dv.getUint32(off, true); off += 4;

  // Build a lookup of every named tensor in the model
  const model_index = buildModelTensorIndex(model);

  let loaded = 0, skipped = 0;
  for (let i = 0; i < nTensors; i++) {
    if (off + 2 > buf.length) break;
    const nameLen = dv.getUint16(off, true); off += 2;
    const name = new TextDecoder("utf-8").decode(buf.subarray(off, off + nameLen));
    off += nameLen;
    const shapeLen = dv.getUint8(off); off += 1;
    const shape: number[] = [];
    for (let s = 0; s < shapeLen; s++) {
      shape.push(dv.getUint32(off, true));
      off += 4;
    }
    const size = shape.reduce((a, b) => a * b, 1);
    const byteLen = size * 4;

    // Float32 view of the data section
    const data = new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + byteLen));
    off += byteLen;

    const target_tensor = model_index.get(name);
    if (!target_tensor) {
      skipped++;
      continue;
    }
    if (target_tensor.size !== size) {
      log.warn(`shape mismatch for ${name}: file=${shape} model=${target_tensor.shape}`);
      skipped++;
      continue;
    }
    target_tensor.data.set(data);
    loaded++;
  }

  log.info(`checkpoint @ ${path.basename(target)}: loaded ${loaded} tensors, skipped ${skipped}`);

  return {
    loaded: loaded > 0,
    path: target,
    format_version: 1,
    tensors_loaded: loaded,
    tensors_skipped: skipped,
    trained_config: trainedConfig,
  };
}

/**
 * Builds a name → Tensor index for every learnable parameter in the model.
 * Names match the Python-side state_dict keys produced by
 * `MindeesMind.state_dict()` in pretrain.py.
 */
function buildModelTensorIndex(model: ModelWeights): Map<string, Tensor> {
  const idx = new Map<string, Tensor>();

  // Embedding
  idx.set("emb.weight", model.embedding.w);

  // Final norm
  idx.set("final_norm", model.finalNorm);

  // LM head (only if untied)
  if (model.lmHead.w) {
    idx.set("lm_head.weight", model.lmHead.w);
  }

  // Per-block tensors — names match the PyTorch hierarchy in pretrain.py
  for (let i = 0; i < model.blocks.length; i++) {
    const b = model.blocks[i]!;
    idx.set(`blocks.${i}.attn_norm`, b.attnNorm);
    idx.set(`blocks.${i}.attn.wq.weight`, b.attn.wQ);
    idx.set(`blocks.${i}.attn.wk.weight`, b.attn.wK);
    idx.set(`blocks.${i}.attn.wv.weight`, b.attn.wV);
    idx.set(`blocks.${i}.attn.wo.weight`, b.attn.wO);
    idx.set(`blocks.${i}.ffn_norm`, b.ffnNorm);
    idx.set(`blocks.${i}.ffn.gate.weight`, b.ffn.wGate);
    idx.set(`blocks.${i}.ffn.up.weight`, b.ffn.wUp);
    idx.set(`blocks.${i}.ffn.down.weight`, b.ffn.wDown);
  }

  return idx;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
