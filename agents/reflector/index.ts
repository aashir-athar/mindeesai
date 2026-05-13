/**
 * Reflector agent — reads a thread, emits structured insights.
 *
 * In the native build, reflection runs through `mindees.generateText()` (the
 * model reflects on its own conversations). Outputs JSON parsed against a
 * schema; malformed responses are dropped rather than crashing the loop.
 */

import { generateText } from "@/core/mindees-mind";
import { REFLECTION_PROMPT } from "@/lib/prompts";
import { readThread } from "@/lib/memory/conversations";
import { recordReflection } from "@/lib/memory/reflections";
import { isoNow, nid, safeJson } from "@/lib/utils";
import type { Reflection } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("reflector");

type LlmReflection = {
  insights: Array<{
    insight: string;
    evidence: string;
    confidence: number;
    retrieval_tag: string;
    action: "system-prompt-update" | "retrieval-bump" | "connector-suggest" | "noop";
  }>;
};

export async function reflectOnThread(threadId: string, signal?: AbortSignal): Promise<Reflection[]> {
  const messages = await readThread(threadId);
  if (messages.length < 2) return [];

  const transcript = messages
    .slice(-20)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const prompt = `${REFLECTION_PROMPT}\n\nTRANSCRIPT:\n${transcript}\n\nEmit the JSON now:\n`;
  const buffer = await generateText(prompt, { temperature: 0.2, maxTokens: 1024, signal });

  const json = buffer
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  const parsed = safeJson<LlmReflection>(json);
  if (!parsed || !Array.isArray(parsed.insights)) {
    log.warn("reflector returned non-JSON", { threadId, preview: buffer.slice(0, 200) });
    return [];
  }

  const reflections: Reflection[] = parsed.insights
    .filter((i) => i.insight && i.evidence && typeof i.confidence === "number")
    .map((i) => ({
      id: nid(),
      threadId,
      insight: i.insight.trim(),
      evidence: i.evidence.trim(),
      confidence: Math.max(0, Math.min(1, i.confidence)),
      retrievalTag: (i.retrieval_tag || "general").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      createdAt: isoNow(),
    }));

  for (const r of reflections) await recordReflection(r);
  log.info(`thread ${threadId}: ${reflections.length} reflections`);
  return reflections;
}
