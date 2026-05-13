/**
 * Auto-research loop — proactive self-learning between turns.
 *
 * After each reply, this module examines the exchange and asks: did Mindees
 * just admit uncertainty about something it could have looked up? Did the
 * user ask about something genuinely novel? If yes, fire a web-search in
 * the background and persist the results as new memories.
 *
 * The next time the user asks about the same area, those passages are
 * retrieved from LanceDB and surface in the system prompt — so Mindees
 * is now smarter about it without anyone running a training tick.
 *
 * THIS is what "self-machine-learning" looks like at the chat-loop level:
 *
 *   user asks → Mindees admits uncertainty → background research →
 *   results stored as memories → next ask hits a Mindees that learned
 *
 * Cost: one Tavily search per triggering turn (~1k searches/mo free).
 * Disabled if TAVILY_API_KEY is missing.
 *
 * Fire-and-forget: this runs DURING the stream's tail close. The user
 * never waits on it.
 */

import { research } from "@/lib/research";
import { createLogger } from "@/lib/logger";

const log = createLogger("auto-research");

/** Hedge phrases that signal Mindees should have known more. */
const HEDGE_MARKERS = [
  "i don't know",
  "i'm not sure",
  "i'm not certain",
  "not certain",
  "let me check",
  "let me look",
  "would need to check",
  "i'd have to look",
  "i'd need to look",
  "i'm not familiar",
  "i don't have current",
  "i don't have up-to-date",
  "as of my last",
  "as of my knowledge",
] as const;

export interface AutoResearchDecision {
  shouldResearch: boolean;
  reason: string;
  topic: string;
}

/**
 * Extract the most-research-worthy noun phrase from a free-text message.
 * Cheap regex extractor — no LLM. Returns the longest capitalised
 * multi-word entity, or the longest quoted phrase, or the longest
 * content noun phrase.
 *
 * Why: passing the WHOLE user message as the research topic produces
 * vague results. A focused topic ("React Server Components" instead of
 * "I keep getting weird hydration errors with React Server Components
 * — any idea what's going on?") gives the provider a query it can
 * actually serve.
 */
function extractFocusedTopic(text: string): string | null {
  // 1. Quoted phrases first (highest-confidence)
  const quoted = /"([^"]{3,80})"/.exec(text);
  if (quoted && quoted[1]) return quoted[1];

  // 2. Capitalised multi-word terms (likely named entities / technical terms)
  const caps = Array.from(text.matchAll(/\b([A-Z][a-zA-Z0-9]{1,20}(?:\s+[A-Z][a-zA-Z0-9]+){0,4})\b/g));
  if (caps.length > 0) {
    const longest = caps.map((m) => m[1] ?? "").sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4) return longest;
  }

  // 3. "about X" / "regarding X" / "on the topic of X"
  const about = /\b(?:about|regarding|on the topic of|tell me about|explain) ((?:[a-z][a-zA-Z0-9-]*\s*){1,5})/.exec(text);
  if (about && about[1]) return about[1].trim();

  return null;
}

export function decideAutoResearch(opts: {
  userMessage: string;
  assistantReply: string;
  curiosityNovelty: number;
  alreadyUsedWebSearch: boolean;
}): AutoResearchDecision {
  const lower = opts.assistantReply.toLowerCase();
  const hedgeHit = HEDGE_MARKERS.find((m) => lower.includes(m));

  // Don't double-research if web-search already fired this turn
  if (opts.alreadyUsedWebSearch) {
    return { shouldResearch: false, reason: "web-search ran this turn", topic: "" };
  }

  // Skip if the user message looks like greeting / chitchat
  if (opts.userMessage.length < 20 || /^(hi|hey|hello|gm|thanks|cool|nice|yes|no)\b/i.test(opts.userMessage.trim())) {
    return { shouldResearch: false, reason: "chitchat", topic: "" };
  }

  // Topic to research — prefer a focused extraction; fall back to the
  // first 200 chars of the message.
  const focusedTopic = extractFocusedTopic(opts.userMessage);
  const topic = focusedTopic ?? opts.userMessage.slice(0, 200);

  // Trigger 1: Mindees hedged in the reply
  if (hedgeHit) {
    return {
      shouldResearch: true,
      reason: `hedged: "${hedgeHit}"`,
      topic,
    };
  }

  // Trigger 2: high novelty + concrete question
  const hasQuestion = opts.userMessage.includes("?");
  const looksConcrete = opts.userMessage.length > 30 && (hasQuestion || /\b(what|how|when|where|who|why|tell me|explain)\b/i.test(opts.userMessage));
  if (opts.curiosityNovelty > 0.65 && looksConcrete) {
    return {
      shouldResearch: true,
      reason: `high novelty ${opts.curiosityNovelty.toFixed(2)}`,
      topic,
    };
  }

  // Trigger 3 (NEW): user mentions a focused named entity Mindees should
  // know about. Fires even without a hedge or extreme novelty — this is
  // the "curious friend goes home and reads up on it" behaviour.
  // Skip if the topic looks like common words the model definitely knows.
  if (focusedTopic && focusedTopic.length >= 6 && opts.curiosityNovelty > 0.40) {
    const lowered = focusedTopic.toLowerCase();
    const COMMON = ["the user", "the same", "the way", "the only", "the thing", "the question"];
    if (!COMMON.some((c) => lowered.startsWith(c))) {
      return {
        shouldResearch: true,
        reason: `named-entity curiosity: "${focusedTopic}" (novelty ${opts.curiosityNovelty.toFixed(2)})`,
        topic: focusedTopic,
      };
    }
  }

  return { shouldResearch: false, reason: "no trigger", topic: "" };
}

/**
 * Execute the research in the background. Persists passages to LanceDB
 * via `research()` (it already stores hits as memories tagged with the
 * source host). Returns a small audit record.
 */
export async function performAutoResearch(opts: {
  topic: string;
  signal?: AbortSignal;
}): Promise<{ topic: string; passages: number; durationMs: number } | null> {
  const start = performance.now();
  // Lazy-import to avoid pulling fs into edge bundles that just import the
  // decide function.
  const { setResearching, clearResearching } = await import("@/lib/research/status");
  await setResearching(opts.topic, "per-turn-hedge");
  try {
    const result = await research(opts.topic, opts.signal);
    const durationMs = performance.now() - start;
    log.info(`auto-research "${opts.topic.slice(0, 60)}" → ${result.passages.length} passages in ${durationMs.toFixed(0)}ms`);
    return { topic: opts.topic, passages: result.passages.length, durationMs };
  } catch (e) {
    log.warn("auto-research failed", e);
    return null;
  } finally {
    await clearResearching();
  }
}
