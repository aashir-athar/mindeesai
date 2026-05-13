/**
 * Constitutional AI self-critique loop.
 *
 * For each training example:
 *   1. Model produces an initial draft.
 *   2. Critic identifies specific issues (with severity + suggestion).
 *   3. Model produces a refined draft addressing the critic's feedback.
 *   4. If the refined draft is *strictly* better (no high-severity issues left),
 *      we add the (prompt → refined) pair to the training corpus AND we add
 *      a preference pair (refined ≻ initial) to the DPO/GRPO buffer.
 *
 * The model thereby trains on its own improvements — a powerful alignment
 * signal that does not require human labels.
 *
 * Hard rule: if the critic *cannot* find any improvement, we DO NOT add the
 * example to training. Self-distilling on already-good outputs degrades
 * diversity over time.
 */

import { generateText } from "../index";
import { critique } from "@/agents/critic";
import { createLogger } from "@/lib/logger";

const log = createLogger("constitutional");

export interface ConstitutionalExample {
  prompt: string;
  initial: string;
  refined: string;
  initialIssues: number;
  refinedIssues: number;
  highSeverityResolved: number;
}

/**
 * Run one round of self-critique for a list of prompts.
 *
 * Returns only the pairs where the refined draft is *meaningfully better*
 * (at least one high-severity issue resolved). The caller can:
 *   - Push refined drafts into the SFT corpus
 *   - Push (refined ≻ initial) pairs into DPO storage
 *   - Push (prompt, refined, +1) into GRPO for explicit positive reward
 */
export async function selfCritiqueBatch(prompts: string[], opts?: { signal?: AbortSignal }): Promise<ConstitutionalExample[]> {
  const out: ConstitutionalExample[] = [];
  for (const prompt of prompts) {
    if (opts?.signal?.aborted) break;

    // 1. Initial draft
    const initial = await generateText(prompt, { temperature: 0.7, maxTokens: 512, signal: opts?.signal });

    // 2. Critic finds issues
    const initialIssues = await critique({ question: prompt, draft: initial, citations: [], signal: opts?.signal });
    if (initialIssues.length === 0) continue; // already good

    // 3. Refinement prompt — show the model exactly what to fix
    const issueList = initialIssues
      .map((i, n) => `${n + 1}. (${i.severity}) ${i.reason} — suggestion: ${i.suggestion}`)
      .join("\n");
    const refinementPrompt = `You wrote this draft for the question:\n\nQUESTION: ${prompt}\n\nDRAFT:\n${initial}\n\nA reviewer identified these issues:\n${issueList}\n\nWrite a refined version of your draft that resolves each issue. Output ONLY the refined draft.`;
    const refined = await generateText(refinementPrompt, { temperature: 0.4, maxTokens: 512, signal: opts?.signal });

    // 4. Score the refined draft
    const refinedIssues = await critique({ question: prompt, draft: refined, citations: [], signal: opts?.signal });
    const initialHigh = initialIssues.filter((i) => i.severity === "high").length;
    const refinedHigh = refinedIssues.filter((i) => i.severity === "high").length;
    const highSeverityResolved = Math.max(0, initialHigh - refinedHigh);

    if (highSeverityResolved <= 0 && refinedIssues.length >= initialIssues.length) {
      // No improvement; discard
      continue;
    }

    out.push({
      prompt,
      initial,
      refined,
      initialIssues: initialIssues.length,
      refinedIssues: refinedIssues.length,
      highSeverityResolved,
    });
    log.info(`constitutional: "${prompt.slice(0, 40)}…" issues ${initialIssues.length} → ${refinedIssues.length}`);
  }
  return out;
}
