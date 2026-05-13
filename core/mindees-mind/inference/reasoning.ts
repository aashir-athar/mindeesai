/**
 * Reasoning-mode generation — DeepSeek-R1 style.
 *
 * The model emits a hidden `<think>...</think>` block before its final answer.
 * The block can be arbitrarily long; harder problems get more reasoning. The
 * model is taught to emit `<think>...</think>` via:
 *   1. Special-token IDs reserved at vocab positions 6 ("<think>") and 7 ("</think>")
 *   2. The reasoning-mode prompt template injected at generation time
 *   3. GRPO reinforcement learning on (problem, reasoning, answer) tuples
 *      where the answer's correctness is graded by the critic
 *
 * Usage:
 *   const { thinking, answer } = await generateWithReasoning({
 *     prompt: "...",
 *     reasoningDepth: "auto" | "shallow" | "deep" | "max",
 *   })
 *
 * "auto" — model decides reasoning length based on difficulty signal
 * "shallow" — cap at 128 reasoning tokens (chat-style questions)
 * "deep"   — cap at 1024
 * "max"    — full cfg.reasoningMaxTokens
 */

import { generate, generateStream, type GenerateOpts } from "./engine";
import { SPECIAL_TOKENS, type BpeTokenizer } from "../tokenizer/bpe";
import type { ModelWeights } from "../model/transformer";

export type ReasoningDepth = "auto" | "shallow" | "deep" | "max";

const DEPTH_BUDGETS: Record<ReasoningDepth, number> = {
  shallow: 128,
  deep: 1024,
  max: Infinity, // capped by cfg.reasoningMaxTokens at the call site
  auto: 512,
};

export interface ReasoningResult {
  thinking: string;
  answer: string;
  thinkingTokens: number;
  answerTokens: number;
  totalMs: number;
}

/**
 * Generate an answer with an explicit reasoning step.
 *
 * Algorithm:
 *   1. Emit the open-think tag and stream tokens until either:
 *        - The model emits the close-think tag, OR
 *        - The reasoning budget is exhausted
 *   2. Append close-think (if not emitted) and stream the final answer.
 *
 * The thinking block is hidden from the user by default — the chat UI may
 * choose to expose it behind a "Show reasoning" disclosure.
 */
export async function generateWithReasoning(opts: {
  model: ModelWeights;
  tokenizer: BpeTokenizer;
  prompt: string;
  depth?: ReasoningDepth;
  signal?: AbortSignal;
  onThinkingChunk?: (chunk: string) => void;
  onAnswerChunk?: (chunk: string) => void;
} & Omit<GenerateOpts, "model" | "tokenizer" | "prompt">): Promise<ReasoningResult> {
  const t0 = performance.now();
  const { model, tokenizer, prompt, depth = "auto", signal, onThinkingChunk, onAnswerChunk, ...sampleOpts } = opts;
  const cfg = model.cfg;
  const budget = Math.min(DEPTH_BUDGETS[depth], cfg.reasoningMaxTokens);

  // Build the reasoning-mode prompt
  const reasoningPrompt = `${prompt}\n<think>`;

  // Stage 1: stream the thinking block
  let thinking = "";
  let thinkingTokens = 0;
  const thinkingStream = generateStream({
    model,
    tokenizer,
    prompt: reasoningPrompt,
    maxTokens: budget,
    temperature: 0.7,
    topP: 0.95,
    stop: ["</think>", "<|endoftext|>"],
    signal,
    ...sampleOpts,
  });

  for await (const piece of thinkingStream) {
    thinking += piece;
    thinkingTokens++;
    onThinkingChunk?.(piece);
    if (thinking.includes("</think>")) {
      thinking = thinking.split("</think>")[0]!;
      break;
    }
  }

  // Stage 2: stream the final answer with reasoning context attached
  const answerPrompt = `${reasoningPrompt}${thinking}</think>\n`;
  let answer = "";
  let answerTokens = 0;
  for await (const piece of generateStream({
    model,
    tokenizer,
    prompt: answerPrompt,
    maxTokens: 1024,
    temperature: 0.4,
    topP: 0.9,
    signal,
    ...sampleOpts,
  })) {
    answer += piece;
    answerTokens++;
    onAnswerChunk?.(piece);
  }

  return {
    thinking: thinking.trim(),
    answer: answer.trim(),
    thinkingTokens,
    answerTokens,
    totalMs: performance.now() - t0,
  };
}

/**
 * Heuristic difficulty estimator — used by `depth: "auto"` to decide whether
 * a question warrants deep reasoning.
 *
 * Signals:
 *   - Question length
 *   - Presence of math / code keywords
 *   - Multi-step phrasing ("first…", "then…", "explain how…", "compare…")
 *   - "why" + "?" combination
 */
export function estimateDifficulty(prompt: string): ReasoningDepth {
  const p = prompt.toLowerCase();
  const length = p.length;

  const hardKeywords = /\b(prove|derive|explain why|compare|analyse|optimi[sz]e|complexity|asymptotic|recursion|invariant|theorem|lemma|step.by.step|gsm8k|integral|matrix|differential|gradient|backpropag)\b/;
  const codeKeywords = /\b(implement|write a function|debug|refactor|optimize this|complexity of|big.o)\b/;
  const mathPattern = /\d+\s*[+\-*/^]\s*\d+|\$.*\$|\\frac|\\sum|\\int/;
  const multiStep = /\b(first|then|next|finally|step \d)\b/i.test(prompt);

  if (hardKeywords.test(p) || codeKeywords.test(p) || mathPattern.test(prompt)) return "deep";
  if (multiStep || length > 280) return "deep";
  if (length < 80) return "shallow";
  return "auto";
}

void SPECIAL_TOKENS; // exported for future trainable tokenizer integration
void generate;
