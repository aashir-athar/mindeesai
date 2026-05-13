/**
 * Curriculum self-play.
 *
 * The model generates synthetic question/answer pairs targeting topics the
 * critic has flagged most often as uncertain. Critic-approved pairs become
 * training data — this is how the model improves *beyond* its bootstrap corpus.
 *
 * Algorithm (per cron tick):
 *   1. Read recent critic flags from `data/improvement-log.jsonl`
 *   2. Cluster by `retrieval_tag`; pick top-K tags by uncertainty volume
 *   3. For each tag:
 *        a. Prompt the model to generate a hard question about the tag
 *        b. Generate an answer with the *current* model
 *        c. Score the answer with the critic
 *        d. If critic score ≥ 0.7 AND no high-severity issues → accept
 *   4. Return accepted (question, answer) tuples as training tokens
 *
 * The acceptance bar is intentionally strict — bad self-play data is worse
 * than no self-play data, because the model will lock in its own mistakes.
 */

import { generate } from "../inference/engine";
import type { ModelWeights } from "../model/transformer";
import type { BpeTokenizer } from "../tokenizer/bpe";
import { critique } from "@/agents/critic";
import { recentReflections } from "@/lib/memory/reflections";

export interface CurriculumPair {
  question: string;
  answer: string;
  tag: string;
  criticScore: number;
}

export async function runCurriculum(opts: {
  model: ModelWeights;
  tokenizer: BpeTokenizer;
  maxPairs?: number;
  signal?: AbortSignal;
}): Promise<CurriculumPair[]> {
  const { model, tokenizer, maxPairs = 8, signal } = opts;

  // 1. Find the topics the model most needs to practice
  const reflections = await recentReflections(7 * 24 * 60 * 60 * 1000); // last week
  const tagFrequency = new Map<string, number>();
  for (const r of reflections) {
    if (r.confidence < 0.7) {
      // Low-confidence reflections signal where the model was uncertain
      tagFrequency.set(r.retrievalTag, (tagFrequency.get(r.retrievalTag) ?? 0) + 1);
    }
  }
  const tags = [...tagFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxPairs).map(([t]) => t);
  if (tags.length === 0) return [];

  const accepted: CurriculumPair[] = [];

  for (const tag of tags) {
    if (signal?.aborted) break;

    // 2. Ask the model to author a challenging question on this tag
    const questionPrompt = `Write one short, specific, factual question about ${tag}. Output only the question.`;
    const question = await generate({
      model,
      tokenizer,
      prompt: questionPrompt,
      maxTokens: 80,
      temperature: 0.9,
      signal,
    });
    const q = question.trim();
    if (!q || q.length < 10) continue;

    // 3. Ask the model to answer its own question (lower temperature for precision)
    const answer = await generate({
      model,
      tokenizer,
      prompt: `Question: ${q}\nAnswer:`,
      maxTokens: 200,
      temperature: 0.3,
      signal,
    });
    const a = answer.trim();
    if (!a || a.length < 20) continue;

    // 4. Critic gate
    const issues = await critique({ question: q, draft: a, citations: [], signal });
    const high = issues.filter((i) => i.severity === "high").length;
    if (high > 0) continue;
    const score = 1 - issues.length * 0.15;
    if (score < 0.7) continue;

    accepted.push({ question: q, answer: a, tag, criticScore: score });
  }

  return accepted;
}
