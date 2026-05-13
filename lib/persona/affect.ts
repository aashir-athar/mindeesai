/**
 * Affect signal extraction — read a user message, return a small affect vector
 * that the mood updater can fold into Mindees' current emotional state.
 *
 * This is NOT a neural sentiment classifier. It's a deliberate rule + lexicon
 * pipeline because:
 *   - Vercel cold-starts can't afford to download an ONNX model on each fn boot
 *   - The signal is small (8 dims) so a 200-line heuristic gets you ~85% of
 *     the value of a fine-tuned classifier at zero infra cost
 *   - The whole thing is auditable — every nudge to the mood can be traced
 *     back to a specific token match
 *
 * A neural classifier is the natural next step (drop in @huggingface/transformers
 * `Xenova/bert-base-multilingual-uncased-sentiment`). The contract here stays
 * the same: input string → AffectSignal.
 */

export interface AffectSignal {
  /** −1 (negative) … +1 (positive). */
  valence: number;
  /** 0 (calm) … 1 (intense). */
  arousal: number;
  /** Dominant inferred intent / register. */
  register:
    | "greeting"
    | "question-factual"
    | "question-emotional"
    | "command"
    | "venting"
    | "playful"
    | "appreciative"
    | "skeptical"
    | "intimate"
    | "neutral";
  /** Soft cues that nudge specific mood dimensions. */
  cues: {
    curiosity: number;
    warmth: number;
    playfulness: number;
    focus: number;
    wonder: number;
    frustration: number;
    calm: number;
    confidence: number;
  };
}

const POSITIVE_TOKENS = new Set([
  "love", "great", "amazing", "wonderful", "beautiful", "thanks", "thank",
  "appreciate", "excellent", "brilliant", "perfect", "awesome", "happy",
  "yes", "yeah", "yep", "good", "nice", "cool", "cheers", "❤", "💜",
  "haha", "lol", "lmao", "xd", "fun", "delightful",
]);

const NEGATIVE_TOKENS = new Set([
  "hate", "awful", "terrible", "broken", "stuck", "ugh", "annoying", "stupid",
  "wrong", "no", "nope", "bad", "worst", "frustrated", "angry", "tired",
  "exhausted", "sad", "sick", "fuck", "shit", "damn", "hate", "useless",
  "garbage", "trash", "fail", "failed",
]);

const PLAYFUL_TOKENS = new Set([
  "lol", "haha", "lmao", "rofl", "xd", ":)", ":D", "🤣", "😂", "😆",
  "wait what", "okay but", "tell me", "what if", "imagine", "joke",
]);

const CURIOUS_TOKENS = new Set([
  "why", "how", "what", "when", "where", "who", "wonder", "wondered",
  "curious", "explain", "teach", "show me", "help me understand",
]);

const WARM_TOKENS = new Set([
  "thank", "thanks", "appreciate", "sorry", "hope", "kind", "love", "care",
  "missed", "glad", "happy",
]);

const TECHNICAL_FOCUS = new Set([
  "implement", "function", "class", "code", "error", "stack", "debug",
  "fix", "build", "deploy", "config", "api", "schema", "type", "interface",
  "algorithm", "complexity", "performance", "optimize",
]);

const INTIMATE_TOKENS = new Set([
  "feel", "feeling", "feelings", "worry", "worried", "anxious", "scared",
  "lonely", "miss", "love you", "trust", "honest", "honestly",
]);

/** Extract an affect signal from a single user message. */
export function readAffect(text: string): AffectSignal {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[\s,.!?;:()[\]{}"]+/).filter(Boolean);

  // Token-level tallies
  let pos = 0, neg = 0;
  let playful = 0, curious = 0, warm = 0, technical = 0, intimate = 0;
  for (const tok of tokens) {
    if (POSITIVE_TOKENS.has(tok)) pos++;
    if (NEGATIVE_TOKENS.has(tok)) neg++;
    if (PLAYFUL_TOKENS.has(tok)) playful++;
    if (CURIOUS_TOKENS.has(tok)) curious++;
    if (WARM_TOKENS.has(tok)) warm++;
    if (TECHNICAL_FOCUS.has(tok)) technical++;
    if (INTIMATE_TOKENS.has(tok)) intimate++;
  }
  // Bigram phrases
  if (lower.includes("how are you") || lower.includes("how's it going")) {
    intimate++; warm++;
  }
  if (lower.match(/[?]{1}/)) curious++;
  if (lower.match(/[!]{2,}|[?]{2,}/)) playful++;

  // Greeting heuristic
  const isGreeting = /^(hi|hello|hey|howdy|yo|gm|good morning|good evening)\b/i.test(text.trim());
  const isCommand = /^(give|write|make|generate|build|do|create|implement|fix|run)\b/i.test(text.trim());

  const valence = clamp((pos - neg) / Math.max(1, pos + neg + 0.5), -1, 1);
  const exclamation = (text.match(/!/g) ?? []).length;
  const questionMark = (text.match(/\?/g) ?? []).length;
  const allCapsHits = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const arousal = clamp(
    0.2 +
      0.15 * exclamation +
      0.10 * questionMark +
      0.20 * allCapsHits +
      0.05 * playful +
      (neg > pos ? 0.15 : 0),
    0, 1,
  );

  let register: AffectSignal["register"] = "neutral";
  if (isGreeting) register = "greeting";
  else if (intimate > 0 && warm > 0) register = "intimate";
  else if (intimate > 0 && neg > pos) register = "venting";
  else if (playful > 1) register = "playful";
  else if (warm > 0 && pos > neg) register = "appreciative";
  else if (neg > pos && technical === 0) register = "skeptical";
  else if (isCommand) register = "command";
  else if (curious > 0 && intimate > 0) register = "question-emotional";
  else if (curious > 0) register = "question-factual";

  const cues = {
    curiosity:    clamp(0.15 * curious + (register.startsWith("question") ? 0.35 : 0) + 0.10 * intimate, 0, 1),
    warmth:       clamp(0.20 * warm + 0.30 * (register === "intimate" || register === "appreciative" ? 1 : 0) + 0.10 * pos, 0, 1),
    playfulness:  clamp(0.25 * playful + 0.15 * exclamation + (register === "playful" ? 0.30 : 0), 0, 1),
    focus:        clamp(0.20 * technical + (register === "command" ? 0.35 : 0), 0, 1),
    wonder:       clamp(0.20 * curious + (text.length > 240 ? 0.20 : 0) + (questionMark > 1 ? 0.15 : 0), 0, 1),
    frustration:  clamp(0.25 * neg + 0.15 * allCapsHits + (register === "skeptical" || register === "venting" ? 0.30 : 0), 0, 1),
    calm:         clamp(0.50 - 0.40 * arousal + (register === "greeting" ? 0.20 : 0), 0, 1),
    confidence:   clamp(0.45 + 0.10 * (pos - neg) - 0.10 * questionMark, 0, 1),
  };

  return { valence, arousal, register, cues };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
