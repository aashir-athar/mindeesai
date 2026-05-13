/**
 * `mindees` — the public surface of the native model.
 *
 * Server-only. The model is a lazy singleton initialised on first call.
 *
 * Public API:
 *   getMind()                                     → { model, tokenizer, cfg }
 *   generateText(prompt, opts?)                   → string
 *   generateTextStream(prompt, opts?)             → AsyncIterable<string>
 *   generateWithReasoning(prompt, opts?)          → { thinking, answer, ... }
 *   bestOfN(prompt, opts)                         → { best, candidates }
 *   speculativeText(prompt, opts)                 → fast generation
 *   selfImproveTick({ sinceMs, signal })          → runs one 5-min training tick
 *   runBenchmark()                                → eval snapshot
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { tokenizerPath, checkpointPath, dataPath } from "@/lib/paths";
import { loadConfig, paramCount, activeParams, type ModelConfig } from "./model/config";
import { initModel, type ModelWeights } from "./model/transformer";
import { generate, generateStream, type GenerateOpts } from "./inference/engine";
import { generateWithReasoning as _generateWithReasoning, estimateDifficulty, type ReasoningDepth } from "./inference/reasoning";
import { bestOfN as _bestOfN } from "./inference/best-of-n";
import { speculativeGenerate, makeGreedyDrafter } from "./inference/speculative";
import { loadTokenizer, type BpeTokenizer } from "./tokenizer/bpe";
import { onlineTrainStep, type TrainBatch } from "./train/online";
import { runCurriculum } from "./train/curriculum";
import { buildPreferencePairs } from "./train/rlhf";
import { selfCritiqueBatch } from "./train/constitutional";
import { grpoStep, type GRPOExample, type RewardFn } from "./train/grpo";
import { harvestConversationTokens, harvestReflectionTokens } from "./data/corpus";
import { getReplayBuffer } from "./data/replay";
import { runEval as _runEval } from "./eval/harness";
import { critique } from "@/agents/critic";
import { createLogger } from "@/lib/logger";

const log = createLogger("mindees");

let modelPromise: Promise<{ model: ModelWeights; tokenizer: BpeTokenizer; cfg: ModelConfig }> | null = null;

async function init(): Promise<{ model: ModelWeights; tokenizer: BpeTokenizer; cfg: ModelConfig }> {
  const cfg = loadConfig();
  log.info(`booting mindees: variant=${cfg.variant} params=${(paramCount(cfg) / 1e6).toFixed(1)}M active=${(activeParams(cfg) / 1e6).toFixed(1)}M`);
  log.info(`features: MoE=${cfg.useMoE}(${cfg.numExperts}x${cfg.expertsPerToken}) MLA=${cfg.useMLA}(latent=${cfg.mlaLatentDim}) MTP=${cfg.useMTP}(depth=${cfg.mtpDepth}) µP=${cfg.useMuP} reasoning=${cfg.useReasoning}`);

  const tokenizerFile = tokenizerPath("tokenizer.json");
  let tokenizer: BpeTokenizer;
  try {
    const raw = await readFile(tokenizerFile, "utf8");
    tokenizer = loadTokenizer(JSON.parse(raw));
    log.info(`tokenizer loaded: ${tokenizer.vocabSize} tokens`);
  } catch {
    log.warn("tokenizer not trained yet — using byte-level stub. Run `pnpm tokenizer:train`.");
    tokenizer = stubTokenizer();
  }

  const model = initModel(cfg);

  // Try to load the trained base.bin checkpoint. If present, this replaces
  // the random initial weights with real trained ones — the moment the
  // native model graduates from "random noise" to "actually learned".
  try {
    const { loadNativeCheckpoint } = await import("./model/load-checkpoint");
    const result = await loadNativeCheckpoint(model);
    if (result.loaded) {
      log.info(`✓ native checkpoint loaded: ${result.tensors_loaded} tensors (${result.tensors_skipped} skipped) from ${result.path}`);
    } else {
      log.info(`no native checkpoint yet (${result.reason ?? "n/a"}). Running with freshly-initialised weights — inference still goes through the LLM router until a checkpoint exists.`);
    }
  } catch (e) {
    log.warn("checkpoint loader failed", e);
  }

  // Probe for a LoRA delta on top of the base (online-tick updates)
  try {
    await readFile(checkpointPath("lora-latest.bin"));
    log.info("LoRA delta detected (online-tick updates) — deserialiser pending");
  } catch { /* none */ }

  return { model, tokenizer, cfg };
}

export async function getMind() {
  if (!modelPromise) modelPromise = init();
  return modelPromise;
}

// ─── inference surface ─────────────────────────────────────────────────────

export async function generateText(prompt: string, opts: Omit<GenerateOpts, "model" | "tokenizer" | "prompt"> = {}): Promise<string> {
  const { model, tokenizer } = await getMind();
  return generate({ ...opts, prompt, model, tokenizer });
}

export async function* generateTextStream(prompt: string, opts: Omit<GenerateOpts, "model" | "tokenizer" | "prompt"> = {}): AsyncIterable<string> {
  const { model, tokenizer } = await getMind();
  for await (const piece of generateStream({ ...opts, prompt, model, tokenizer })) yield piece;
}

/** Reasoning-mode generation. depth="auto" routes by difficulty heuristic. */
export async function generateWithReasoning(prompt: string, opts: { depth?: ReasoningDepth; signal?: AbortSignal; onThinkingChunk?: (s: string) => void; onAnswerChunk?: (s: string) => void } = {}) {
  const { model, tokenizer, cfg } = await getMind();
  if (!cfg.useReasoning) {
    const answer = await generate({ model, tokenizer, prompt });
    return { thinking: "", answer, thinkingTokens: 0, answerTokens: answer.length, totalMs: 0 };
  }
  const depth = opts.depth ?? estimateDifficulty(prompt);
  return _generateWithReasoning({ model, tokenizer, prompt, depth, signal: opts.signal, onThinkingChunk: opts.onThinkingChunk, onAnswerChunk: opts.onAnswerChunk });
}

/** Best-of-N: generate N candidates, pick the highest critic-scored. */
export async function bestOfN(prompt: string, opts: { n?: number; temperature?: number; signal?: AbortSignal } = {}) {
  const n = opts.n ?? 4;
  const scorer = async (completion: string): Promise<number> => {
    const issues = await critique({ question: prompt, draft: completion, citations: [], signal: opts.signal });
    const high = issues.filter((i) => i.severity === "high").length * 0.5;
    const med = issues.filter((i) => i.severity === "medium").length * 0.2;
    const low = issues.filter((i) => i.severity === "low").length * 0.05;
    return Math.max(0, 1 - (high + med + low));
  };
  return _bestOfN({ prompt, n, scorer, temperature: opts.temperature ?? 0.85, signal: opts.signal });
}

/** Speculative decoding using a greedy self-drafter. */
export async function speculativeText(prompt: string, opts: { maxTokens?: number; k?: number; signal?: AbortSignal } = {}) {
  const { model, tokenizer } = await getMind();
  const drafter = await makeGreedyDrafter(model);
  return speculativeGenerate({
    model, tokenizer, drafter, prompt,
    maxTokens: opts.maxTokens ?? 256,
    k: opts.k ?? 4,
    signal: opts.signal,
  });
}

// ─── training surface ─────────────────────────────────────────────────────

/**
 * Run one self-improvement training tick.
 * Composes SFT, curriculum, constitutional, DPO, GRPO, and the eval-gated commit.
 */
export async function selfImproveTick(opts: { sinceMs: number; signal?: AbortSignal } = { sinceMs: Date.now() - 5 * 60_000 }) {
  const { model, tokenizer } = await getMind();
  const batches: TrainBatch[] = [];

  const conv = await harvestConversationTokens({ tokenizer, sinceMs: opts.sinceMs, maxTokensPerThread: 1024 });
  for (const c of conv) batches.push({ tokens: c.tokens, source: "conversation" });

  const refl = await harvestReflectionTokens({ tokenizer, minConfidence: 0.7, maxTokens: 2048 });
  if (refl.length > 0) batches.push({ tokens: refl, source: "reflection" });

  if (!opts.signal?.aborted) {
    try {
      const pairs = await runCurriculum({ model, tokenizer, maxPairs: 4, signal: opts.signal });
      for (const p of pairs) {
        const text = `Question: ${p.question}\nAnswer: ${p.answer}`;
        batches.push({ tokens: tokenizer.encode(text, { bos: true, eos: true }), source: "curriculum" });
      }
    } catch (e) { log.warn("curriculum failed", e); }
  }

  if (!opts.signal?.aborted) {
    try {
      const samplePrompts = conv.slice(0, 3).map((c) => decodeFirstUserTurn(c.tokens, tokenizer)).filter((p): p is string => !!p);
      const refined = await selfCritiqueBatch(samplePrompts, { signal: opts.signal });
      for (const r of refined) {
        const text = `${r.prompt}\n${r.refined}`;
        batches.push({ tokens: tokenizer.encode(text, { bos: true, eos: true }), source: "constitutional" });
      }
    } catch (e) { log.warn("constitutional failed", e); }
  }

  try {
    const prefs = await buildPreferencePairs({ conversationsDir: dataPath("conversations") });
    for (const p of prefs) {
      batches.push({ tokens: tokenizer.encode(`${p.prompt}\n${p.chosen}`, { bos: true, eos: true }), source: "dpo-chosen" });
      batches.push({ tokens: tokenizer.encode(`${p.prompt}\n${p.rejected}`, { bos: true, eos: true }), source: "dpo-rejected" });
    }
  } catch (e) { log.warn("rlhf failed", e); }

  const replay = await getReplayBuffer();
  for (const e of replay.sample(8)) batches.push({ tokens: new Int32Array(e.tokens), source: e.source });
  for (const b of batches.slice(0, 16)) {
    replay.push({ tokens: Array.from(b.tokens), source: b.source, score: 1, createdAt: new Date().toISOString() });
  }
  await replay.save();

  if (batches.length === 0) {
    log.info("self-improve: no fresh data — skipping");
    return { loss: 0, tokens: 0, ms: 0, committed: true, rollbackReasons: [] };
  }

  const sftResult = await onlineTrainStep(model, tokenizer, batches);

  // GRPO step on top of SFT
  if (!opts.signal?.aborted) {
    try {
      const grpoExamples: GRPOExample[] = conv.slice(0, 3)
        .map((c) => decodeFirstUserTurn(c.tokens, tokenizer))
        .filter((p): p is string => !!p)
        .map((p) => ({ prompt: p }));
      if (grpoExamples.length > 0) {
        const reward: RewardFn = async ({ prompt, completion }) => {
          const issues = await critique({ question: prompt, draft: completion, citations: [], signal: opts.signal });
          const high = issues.filter((i) => i.severity === "high").length;
          return Math.max(0, 1 - high * 0.4 - issues.length * 0.05);
        };
        await grpoStep({ model, tokenizer, examples: grpoExamples, reward, signal: opts.signal });
      }
    } catch (e) { log.warn("grpo failed", e); }
  }

  return sftResult;
}

export async function runBenchmark() {
  const { model, tokenizer } = await getMind();
  return _runEval(model, tokenizer);
}

function decodeFirstUserTurn(tokens: Int32Array, tokenizer: BpeTokenizer): string | null {
  // Specials: BOS=0 EOS=1 USER=3 ASSISTANT=4
  const collected: number[] = [];
  let inUser = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 3) { inUser = true; continue; }
    if (inUser && (t === 4 || t === 1)) break;
    if (inUser) collected.push(t);
  }
  if (collected.length === 0) return null;
  return tokenizer.decode(collected).trim() || null;
}

function stubTokenizer(): BpeTokenizer {
  const idToBytes: Uint8Array[] = [];
  for (let i = 0; i < 8; i++) idToBytes.push(new Uint8Array(0));
  for (let b = 0; b < 256; b++) idToBytes.push(new Uint8Array([b]));
  return loadTokenizer({
    vocab: idToBytes.map((b) => Buffer.from(b).toString("base64")),
    merges: [],
  });
}

export type { ModelConfig, ModelWeights, BpeTokenizer };
export { paramCount, activeParams };
