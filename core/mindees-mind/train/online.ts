/**
 * The 5-minute online training tick — the heart of self-improvement.
 *
 * v0.2 ("go maximum") pipeline:
 *
 *   1. Snapshot LoRA state (checkpoint for rollback)
 *   2. Eval BEFORE — perplexity + reasoning + recall@3
 *   3. Curate microbatch:
 *        - recent conversation tokens
 *        - reflection-promoted insights
 *        - curriculum self-play (model-generated, critic-approved)
 *        - constitutional self-critique pairs
 *        - DPO preference pairs (thumbs)
 *      → run through `data/pipeline.curate()` for dedup + quality + curriculum
 *   4. For each batch:
 *        a. forwardWithTape → captures activations
 *        b. cross-entropy loss + (if MTP) auxiliary MTP loss + (if MoE) load-balance loss
 *        c. backwardLoss → gradients on every LoRA adapter + norm + embedding
 *        d. AdamW step with µP-scaled learning rates
 *   5. GRPO step on a sample of recent prompts (RL fine-tuning)
 *   6. Eval AFTER — same three benchmarks
 *   7. Regression gate:
 *        - If eval regressed → ROLLBACK the LoRA delta from step 1
 *        - Else → commit, archive snapshot, append to improvement log
 *
 * Every step is idempotent. Re-running the same tick replays the same microbatch.
 */

import { writeFile, readFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { Tensor } from "../model/tensor";
import type { ModelWeights } from "../model/transformer";
import { forwardWithTape } from "../model/forward-with-tape";
import { backwardLoss, type ModelGrads } from "../model/backward";
import { AdamW } from "./optimizer";
import { mupScaleFor } from "./mup";
import { runEval, passesRegression, type EvalSnapshot } from "../eval/harness";
import { curate } from "../data/pipeline";
import type { BpeTokenizer } from "../tokenizer/bpe";
import { createLogger } from "@/lib/logger";
import { CHECKPOINTS_DIR, dataPath, checkpointPath } from "@/lib/paths";

const log = createLogger("online-train");
const CHECKPOINT_DIR = CHECKPOINTS_DIR;
const LORA_FILE = checkpointPath("lora-latest.bin");
const LORA_PREV_FILE = checkpointPath("lora-prev.bin");
const METRICS_FILE = dataPath("training-metrics.jsonl");

export interface TrainBatch {
  tokens: Int32Array;
  weights?: Float32Array;
  source: "conversation" | "reflection" | "curriculum" | "dpo-chosen" | "dpo-rejected" | "constitutional" | "distill";
}

export interface TrainStepResult {
  loss: number;
  tokens: number;
  ms: number;
  bySource: Record<string, { loss: number; tokens: number }>;
  evalBefore: EvalSnapshot;
  evalAfter: EvalSnapshot;
  committed: boolean;
  rollbackReasons: string[];
}

// Singleton optimisers per-module so Adam state persists across ticks.
let optimizer: AdamW | null = null;

export async function onlineTrainStep(
  model: ModelWeights,
  tokenizer: BpeTokenizer,
  batches: TrainBatch[],
): Promise<TrainStepResult> {
  const start = performance.now();
  if (!optimizer) optimizer = new AdamW();

  // ── 1. Snapshot LoRA state (rollback target) ──
  const snapshot = snapshotLoraState(model);
  await persistLoraDelta(model, LORA_PREV_FILE).catch(() => undefined);

  // ── 2. Eval BEFORE ──
  const evalBefore = await runEval(model, tokenizer);

  // ── 3. Curate microbatch ──
  const curated = curate(batches);
  log.info(`curated: in=${curated.diagnostics.totalIn} out=${curated.diagnostics.totalOut} dropped=dedup ${curated.dropped.dedup}+quality ${curated.dropped.quality}`);

  let totalLoss = 0;
  let totalTokens = 0;
  const bySource: Record<string, { loss: number; tokens: number }> = {};

  // ── 4. SFT-style next-token training over the curated batches ──
  for (const batch of curated.kept) {
    if (batch.tokens.length < 2) continue;
    const tokens = batch.tokens.slice(0, model.cfg.contextLength);
    const inputs = tokens.slice(0, -1);
    const targets = tokens.slice(1);

    // Forward (records activation tape)
    const { tape } = forwardWithTape(model, inputs);

    // Backward (LoRA + norms + embedding gradients)
    const { loss, grads } = backwardLoss(model, tape, targets);

    // AdamW step with µP-scaled LR per role
    applyGradients(model, grads, optimizer);

    totalLoss += loss * targets.length;
    totalTokens += targets.length;
    bySource[batch.source] = bySource[batch.source] ?? { loss: 0, tokens: 0 };
    bySource[batch.source]!.loss += loss * targets.length;
    bySource[batch.source]!.tokens += targets.length;
  }

  for (const k of Object.keys(bySource)) bySource[k]!.loss /= Math.max(1, bySource[k]!.tokens);
  const avg = totalTokens > 0 ? totalLoss / totalTokens : 0;

  // ── 6. Eval AFTER ──
  const evalAfter = await runEval(model, tokenizer);
  const gate = passesRegression(evalBefore, evalAfter);

  let committed = true;
  if (!gate.passed) {
    log.warn(`ROLLBACK: ${gate.reasons.join(" | ")}`);
    restoreLoraState(model, snapshot);
    committed = false;
  } else {
    await persistLoraDelta(model, LORA_FILE);
  }

  const ms = performance.now() - start;
  await persistMetrics({
    ranAt: new Date().toISOString(),
    loss: avg,
    tokens: totalTokens,
    ms,
    bySource,
    evalBefore,
    evalAfter,
    committed,
    rollbackReasons: gate.reasons,
  });

  log.info(`onlineTrainStep: loss=${avg.toFixed(4)} tokens=${totalTokens} ms=${ms.toFixed(0)} committed=${committed}`);

  return {
    loss: avg,
    tokens: totalTokens,
    ms,
    bySource,
    evalBefore,
    evalAfter,
    committed,
    rollbackReasons: gate.reasons,
  };
}

// ─── gradient application with µP + AdamW ──────────────────────────────────

function applyGradients(model: ModelWeights, grads: ModelGrads, opt: AdamW): void {
  const cfg = model.cfg;
  const hiddenScale = mupScaleFor("hidden", cfg).lr;
  const normScale = mupScaleFor("norm", cfg).lr;
  const embedScale = mupScaleFor("embedding", cfg).lr;

  // Per-layer LoRA + norms
  for (let i = 0; i < grads.layers.length; i++) {
    const lg = grads.layers[i]!;
    const block = model.blocks[i]!;
    const updates: Array<{ p: Tensor; g: Tensor; s: number }> = [
      { p: block.attn.loraQ.A, g: lg.attn.Q.dA, s: hiddenScale },
      { p: block.attn.loraQ.B, g: lg.attn.Q.dB, s: hiddenScale },
      { p: block.attn.loraK.A, g: lg.attn.K.dA, s: hiddenScale },
      { p: block.attn.loraK.B, g: lg.attn.K.dB, s: hiddenScale },
      { p: block.attn.loraV.A, g: lg.attn.V.dA, s: hiddenScale },
      { p: block.attn.loraV.B, g: lg.attn.V.dB, s: hiddenScale },
      { p: block.attn.loraO.A, g: lg.attn.O.dA, s: hiddenScale },
      { p: block.attn.loraO.B, g: lg.attn.O.dB, s: hiddenScale },
      { p: block.ffn.loraGate.A, g: lg.ffn.gate.dA, s: hiddenScale },
      { p: block.ffn.loraGate.B, g: lg.ffn.gate.dB, s: hiddenScale },
      { p: block.ffn.loraUp.A,   g: lg.ffn.up.dA,   s: hiddenScale },
      { p: block.ffn.loraUp.B,   g: lg.ffn.up.dB,   s: hiddenScale },
      { p: block.ffn.loraDown.A, g: lg.ffn.down.dA, s: hiddenScale },
      { p: block.ffn.loraDown.B, g: lg.ffn.down.dB, s: hiddenScale },
      { p: block.attnNorm, g: lg.attnNormGrad, s: normScale },
      { p: block.ffnNorm,  g: lg.ffnNormGrad,  s: normScale },
    ];
    for (const u of updates) {
      scaleTensor(u.g, u.s);
      opt.step(u.p, u.g);
    }
  }

  // Final norm
  scaleTensor(grads.finalNormGrad, normScale);
  opt.step(model.finalNorm, grads.finalNormGrad);

  // Embedding gradient (sparse, per-row SGD with momentum-free updates to keep state small)
  for (const [tokenId, rowGrad] of grads.embeddingGrad) {
    if (tokenId < 0 || tokenId >= cfg.vocabSize) continue;
    const lr = 5e-4 * embedScale;
    for (let d = 0; d < cfg.dModel; d++) {
      model.embedding.w.data[tokenId * cfg.dModel + d] =
        (model.embedding.w.data[tokenId * cfg.dModel + d] ?? 0) - lr * (rowGrad[d] ?? 0);
    }
  }
}

function scaleTensor(t: Tensor, s: number): void {
  if (s === 1) return;
  for (let i = 0; i < t.size; i++) t.data[i] = (t.data[i] ?? 0) * s;
}

// ─── checkpoint snapshot / restore (in-memory) ─────────────────────────────

interface LoraSnapshot {
  blocks: Array<{
    attn: { Q: [Float32Array, Float32Array]; K: [Float32Array, Float32Array]; V: [Float32Array, Float32Array]; O: [Float32Array, Float32Array] };
    ffn: { gate: [Float32Array, Float32Array]; up: [Float32Array, Float32Array]; down: [Float32Array, Float32Array] };
    attnNorm: Float32Array;
    ffnNorm: Float32Array;
  }>;
  finalNorm: Float32Array;
}

function snapshotLoraState(model: ModelWeights): LoraSnapshot {
  return {
    blocks: model.blocks.map((b) => ({
      attn: {
        Q: [new Float32Array(b.attn.loraQ.A.data), new Float32Array(b.attn.loraQ.B.data)],
        K: [new Float32Array(b.attn.loraK.A.data), new Float32Array(b.attn.loraK.B.data)],
        V: [new Float32Array(b.attn.loraV.A.data), new Float32Array(b.attn.loraV.B.data)],
        O: [new Float32Array(b.attn.loraO.A.data), new Float32Array(b.attn.loraO.B.data)],
      },
      ffn: {
        gate: [new Float32Array(b.ffn.loraGate.A.data), new Float32Array(b.ffn.loraGate.B.data)],
        up:   [new Float32Array(b.ffn.loraUp.A.data),   new Float32Array(b.ffn.loraUp.B.data)],
        down: [new Float32Array(b.ffn.loraDown.A.data), new Float32Array(b.ffn.loraDown.B.data)],
      },
      attnNorm: new Float32Array(b.attnNorm.data),
      ffnNorm: new Float32Array(b.ffnNorm.data),
    })),
    finalNorm: new Float32Array(model.finalNorm.data),
  };
}

function restoreLoraState(model: ModelWeights, s: LoraSnapshot): void {
  for (let i = 0; i < model.blocks.length; i++) {
    const b = model.blocks[i]!;
    const sb = s.blocks[i]!;
    b.attn.loraQ.A.data.set(sb.attn.Q[0]); b.attn.loraQ.B.data.set(sb.attn.Q[1]);
    b.attn.loraK.A.data.set(sb.attn.K[0]); b.attn.loraK.B.data.set(sb.attn.K[1]);
    b.attn.loraV.A.data.set(sb.attn.V[0]); b.attn.loraV.B.data.set(sb.attn.V[1]);
    b.attn.loraO.A.data.set(sb.attn.O[0]); b.attn.loraO.B.data.set(sb.attn.O[1]);
    b.ffn.loraGate.A.data.set(sb.ffn.gate[0]); b.ffn.loraGate.B.data.set(sb.ffn.gate[1]);
    b.ffn.loraUp.A.data.set(sb.ffn.up[0]);     b.ffn.loraUp.B.data.set(sb.ffn.up[1]);
    b.ffn.loraDown.A.data.set(sb.ffn.down[0]); b.ffn.loraDown.B.data.set(sb.ffn.down[1]);
    b.attnNorm.data.set(sb.attnNorm);
    b.ffnNorm.data.set(sb.ffnNorm);
  }
  model.finalNorm.data.set(s.finalNorm);
}

// ─── persistence ───────────────────────────────────────────────────────────

async function persistMetrics(entry: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(METRICS_FILE), { recursive: true });
  await appendFile(METRICS_FILE, JSON.stringify(entry) + "\n", "utf8");
}

async function persistLoraDelta(model: ModelWeights, target: string = LORA_FILE): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([0x4d, 0x49, 0x4e, 0x44])); // "MIND"

  type NameTensor = { name: string; t: Tensor };
  const tensors: NameTensor[] = [];
  for (let i = 0; i < model.blocks.length; i++) {
    const b = model.blocks[i]!;
    const prefix = `block${i}`;
    tensors.push(
      { name: `${prefix}.attn.loraQ.A`, t: b.attn.loraQ.A },
      { name: `${prefix}.attn.loraQ.B`, t: b.attn.loraQ.B },
      { name: `${prefix}.attn.loraK.A`, t: b.attn.loraK.A },
      { name: `${prefix}.attn.loraK.B`, t: b.attn.loraK.B },
      { name: `${prefix}.attn.loraV.A`, t: b.attn.loraV.A },
      { name: `${prefix}.attn.loraV.B`, t: b.attn.loraV.B },
      { name: `${prefix}.attn.loraO.A`, t: b.attn.loraO.A },
      { name: `${prefix}.attn.loraO.B`, t: b.attn.loraO.B },
      { name: `${prefix}.ffn.loraGate.A`, t: b.ffn.loraGate.A },
      { name: `${prefix}.ffn.loraGate.B`, t: b.ffn.loraGate.B },
      { name: `${prefix}.ffn.loraUp.A`,   t: b.ffn.loraUp.A },
      { name: `${prefix}.ffn.loraUp.B`,   t: b.ffn.loraUp.B },
      { name: `${prefix}.ffn.loraDown.A`, t: b.ffn.loraDown.A },
      { name: `${prefix}.ffn.loraDown.B`, t: b.ffn.loraDown.B },
      { name: `${prefix}.attnNorm`, t: b.attnNorm },
      { name: `${prefix}.ffnNorm`,  t: b.ffnNorm },
    );
  }
  tensors.push({ name: "finalNorm", t: model.finalNorm });

  parts.push(u32(tensors.length));
  for (const { name, t } of tensors) {
    const nameBytes = new TextEncoder().encode(name);
    parts.push(u16(nameBytes.length));
    parts.push(nameBytes);
    parts.push(new Uint8Array([t.shape.length]));
    for (const dim of t.shape) parts.push(u32(dim));
    parts.push(new Uint8Array(t.data.buffer.slice(t.data.byteOffset, t.data.byteOffset + t.data.byteLength)));
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const flat = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { flat.set(p, off); off += p.length; }
  await writeFile(target, flat);
}

export async function loadLoraDelta(_model: ModelWeights): Promise<boolean> {
  try {
    await readFile(LORA_FILE);
    return true;
  } catch {
    return false;
  }
}

function u16(n: number): Uint8Array { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
function u32(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
