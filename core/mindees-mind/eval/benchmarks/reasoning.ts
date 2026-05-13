/**
 * Reasoning benchmark — a small held-out set of arithmetic + logic puzzles.
 *
 * Each problem has a deterministic ground-truth answer extractable via regex.
 * Score = fraction of problems where the model's final answer (after the
 * reasoning block) matches.
 *
 * Why arithmetic + logic and not coding? Because a self-graded benchmark MUST
 * use deterministic graders. Code execution is brittle in a serverless env.
 */

import { generateWithReasoning } from "../../inference/reasoning";
import type { ModelWeights } from "../../model/transformer";
import type { BpeTokenizer } from "../../tokenizer/bpe";

interface ReasoningTask {
  prompt: string;
  /** Regex that, applied to the model's answer, must match for the task to count as solved. */
  expected: RegExp;
}

/**
 * Built-in benchmark set. Kept tiny — the regression gate just needs *direction*,
 * not a leaderboard-grade evaluation. Use the Python harness for that.
 */
const TASKS: ReasoningTask[] = [
  { prompt: "What is 17 + 42? Give just the number.", expected: /\b59\b/ },
  { prompt: "What is 13 * 7?  Give just the number.", expected: /\b91\b/ },
  { prompt: "Alice has 5 apples. She gives 2 to Bob. How many does Alice have left? Give just the number.", expected: /\b3\b/ },
  { prompt: "If today is Tuesday, what day will it be in 10 days? Give just the name of the day.", expected: /Friday/i },
  { prompt: "I have 3 cats and 2 dogs. How many tails are there? Give just the number.", expected: /\b5\b/ },
  { prompt: "A train leaves at 14:30 and arrives at 17:15. How many minutes did the trip take? Give just the number.", expected: /\b165\b/ },
  { prompt: "What is the next number in the sequence: 2, 4, 8, 16, ?", expected: /\b32\b/ },
  { prompt: "If all roses are flowers, and some flowers are red, can we conclude that some roses are red? Answer yes or no with one sentence.", expected: /\bno\b/i },
];

export interface ReasoningEvalResult {
  passed: number;
  total: number;
  accuracy: number;
  ms: number;
  perTask: Array<{ prompt: string; answer: string; passed: boolean }>;
}

export async function evaluateReasoning(model: ModelWeights, tokenizer: BpeTokenizer): Promise<ReasoningEvalResult> {
  const t0 = performance.now();
  const perTask: ReasoningEvalResult["perTask"] = [];
  let passed = 0;
  for (const task of TASKS) {
    const { answer } = await generateWithReasoning({
      model,
      tokenizer,
      prompt: task.prompt,
      depth: "shallow",
    });
    const ok = task.expected.test(answer);
    if (ok) passed++;
    perTask.push({ prompt: task.prompt, answer, passed: ok });
  }
  return {
    passed,
    total: TASKS.length,
    accuracy: passed / TASKS.length,
    ms: performance.now() - t0,
    perTask,
  };
}
