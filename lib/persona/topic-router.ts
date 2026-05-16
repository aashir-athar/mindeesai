/**
 * Topic router — zero-shot classification of user messages into capability
 * buckets so the orchestrator can pick the right system prompt biases and
 * connector subsets per turn.
 *
 * Uses `Xenova/nli-deberta-v3-xsmall` (~50 MB Q8) — zero-shot, so we can
 * change candidate labels at any time without retraining anything.
 *
 * The router does NOT block or hard-route — it just adds a soft hint the
 * system prompt builder can use. If the classifier is unavailable or
 * uncertain, the orchestrator defaults to its normal behaviour.
 */

import { zeroShotPipeline } from "@/lib/ml/transformers-pool";
import { createLogger } from "@/lib/logger";

const log = createLogger("topic-router");

/** The buckets we care about. Order matters for tie-breaking on near-ties. */
export const TOPIC_LABELS = [
  "code",       // programming / debugging / API questions
  "math",       // arithmetic, algebra, calculus, statistics
  "personal",   // user's feelings, relationships, life events
  "creative",   // writing, brainstorming, design ideas
  "factual",    // "what is X", "how does Y work", general knowledge
  "meta",       // about Mindees itself, about the conversation
] as const;

export type Topic = (typeof TOPIC_LABELS)[number];

export interface TopicVerdict {
  /** Top-scoring label. */
  top: Topic;
  /** Score of the top label, 0-1. */
  topScore: number;
  /** Full distribution. */
  scores: Record<Topic, number>;
  /** True if we're confident — `topScore - secondScore` is decisive. */
  confident: boolean;
  /** Where the verdict came from. */
  source: "zero-shot" | "fallback";
}

/** Below this margin between top and second, the router refuses to commit. */
const DECISIVE_MARGIN = 0.12;

/** Run zero-shot classification on the user message. Never throws.
 *
 *  Time-boxed at 2s — if the classifier is mid-cold-load on a serverless
 *  instance, the router returns a low-confidence "factual" fallback
 *  rather than block the chat path.
 */
export async function classifyTopic(text: string): Promise<TopicVerdict> {
  if (!text || text.length < 3) {
    return makeFallback();
  }

  const pl = await Promise.race([
    zeroShotPipeline(),
    new Promise<null>((res) => setTimeout(() => res(null), 2000)),
  ]);
  if (!pl) return makeFallback();

  try {
    const out = (await pl(text, TOPIC_LABELS as unknown as string[], {
      multi_label: false,
    } as unknown as object)) as unknown as {
      labels: string[];
      scores: number[];
    };
    if (!out || !Array.isArray(out.labels) || !Array.isArray(out.scores)) {
      return makeFallback();
    }
    const scores: Partial<Record<Topic, number>> = {};
    for (let i = 0; i < out.labels.length; i++) {
      const label = out.labels[i] as Topic;
      const score = out.scores[i] ?? 0;
      if (TOPIC_LABELS.includes(label)) scores[label] = score;
    }
    for (const lbl of TOPIC_LABELS) {
      if (scores[lbl] === undefined) scores[lbl] = 0;
    }
    const full = scores as Record<Topic, number>;
    const sorted = TOPIC_LABELS
      .map((l) => [l, full[l]] as const)
      .sort((a, b) => b[1] - a[1]);
    const top = sorted[0]![0];
    const topScore = sorted[0]![1];
    const secondScore = sorted[1]?.[1] ?? 0;
    return {
      top,
      topScore,
      scores: full,
      confident: topScore - secondScore >= DECISIVE_MARGIN,
      source: "zero-shot",
    };
  } catch (e) {
    log.warn("zero-shot inference failed; using fallback", e);
    return makeFallback();
  }
}

function makeFallback(): TopicVerdict {
  const scores = Object.fromEntries(TOPIC_LABELS.map((l) => [l, 0])) as Record<Topic, number>;
  scores.factual = 0.5;
  return {
    top: "factual",
    topScore: 0.5,
    scores,
    confident: false,
    source: "fallback",
  };
}

/**
 * Short narrative hint the orchestrator can splice into the system prompt
 * so the model knows what register / depth to use. Only emitted when the
 * router is confident — otherwise we don't bias.
 */
export function topicSystemHint(v: TopicVerdict): string {
  if (!v.confident) return "";
  switch (v.top) {
    case "code":
      return "This message is a coding question. Prefer concrete examples, name the language, give runnable snippets, and call out edge cases.";
    case "math":
      return "This message is a math/reasoning question. Show the steps, not just the final answer. Stay rigorous about units, signs, and edge cases.";
    case "personal":
      return "This message is personal — the user is sharing about themselves or how they feel. Lead with acknowledgement, not with solving. Stay in the listening register.";
    case "creative":
      return "This message is a creative ask (writing, ideas, design). Generate options, not a single answer. Each option should feel distinct.";
    case "factual":
      return "This message is a factual question. Be concise. Cite sources when the answer needs verification.";
    case "meta":
      return "This message is about Mindees or the conversation itself. Be honest about what's persisted, what's not, and what the system is doing.";
  }
}

/**
 * Connector hint — names of connectors that are most useful for this topic.
 * The orchestrator can use this to prune the tool list it shows the model
 * (smaller tool list = lower chance of bad tool choice).
 */
export function topicConnectorHint(v: TopicVerdict): string[] | null {
  if (!v.confident) return null;
  switch (v.top) {
    case "code":     return ["code-exec", "github-search", "stackoverflow", "web-search"];
    case "math":     return ["calculator", "wikipedia", "arxiv"];
    case "personal": return ["reflect", "datetime"];  // narrow — personal questions rarely need tools
    case "creative": return ["reflect", "web-search"];
    case "factual":  return ["web-search", "wikipedia", "web-crawl", "dictionary"];
    case "meta":     return ["reflect"];
  }
}
