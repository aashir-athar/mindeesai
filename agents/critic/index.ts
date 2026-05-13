/**
 * Critic agent — adversarial reviewer that scans a draft answer for likely
 * hallucinations before the user sees it.
 *
 * Uses the native MindeesAI model. Outputs structured JSON; missing/malformed
 * output yields an empty issues list (fail open — never block on critic).
 */

import { generateText } from "@/core/mindees-mind";
import { safeJson } from "@/lib/utils";

const CRITIC_PROMPT = `\
You are MindeesAI's *critic*. Your only job is to flag likely hallucinations in a draft assistant answer.

You will receive:
- The user's question
- The draft answer
- The citations attached (may be empty)

Emit ONLY this JSON:
{
  "issues": [
    { "claim": "<exact substring>", "severity": "high|medium|low", "reason": "<one sentence>", "suggestion": "<add citation|soften|remove>" }
  ]
}

Rules:
- Be ruthless. Better to over-flag than under-flag.
- "Common knowledge" requires no citation; specific stats, names, and dates do.
- If the draft is clean, emit { "issues": [] }.
`;

export type CritiqueIssue = {
  claim: string;
  severity: "high" | "medium" | "low";
  reason: string;
  suggestion: string;
};

export async function critique(opts: {
  question: string;
  draft: string;
  citations: Array<{ title: string; url: string }>;
  signal?: AbortSignal;
}): Promise<CritiqueIssue[]> {
  const { question, draft, citations, signal } = opts;
  const citationsBlock = citations.map((c) => `- ${c.title} (${c.url})`).join("\n") || "(none)";
  const prompt = `${CRITIC_PROMPT}\n\nQUESTION:\n${question}\n\nDRAFT:\n${draft}\n\nCITATIONS:\n${citationsBlock}\n\nEmit the JSON now:\n`;

  const buffer = await generateText(prompt, { temperature: 0.1, maxTokens: 512, signal });
  const json = buffer.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const parsed = safeJson<{ issues: CritiqueIssue[] }>(json);
  return parsed?.issues ?? [];
}
