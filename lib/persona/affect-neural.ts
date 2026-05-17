/**
 * Neural emotion classifier — drop-in augmentation for the rule-based
 * AffectSignal.
 *
 * Previously ran `Xenova/emotion-english-distilroberta-base` in-process via
 * transformers.js. That dependency is gone (Cloudflare Workers can't load
 * the native binary). To restore the 7-class emotion signal end-to-end,
 * the sidecar would need a dedicated /classify task for the emotion model.
 *
 * For now, `readNeuralEmotion` always returns `null`, which makes the
 * existing graceful-fallback path in callers do the right thing: the
 * rule-based cues + Twitter-sentiment + toxicity already cover the bulk
 * of the signal, and `blendNeuralIntoCues` is a no-op on null.
 *
 * To re-enable: add a `"emotion"` task to the sidecar (scripts/sidecar/),
 * point it at `Xenova/emotion-english-distilroberta-base`, then swap the
 * stub below for a `sidecarClassify({ task: "emotion", text })` call.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("affect-neural");

export type NeuralEmotion =
  | "anger"
  | "disgust"
  | "fear"
  | "joy"
  | "neutral"
  | "sadness"
  | "surprise";

export interface NeuralEmotionRead {
  top: NeuralEmotion;
  scores: Record<NeuralEmotion, number>;
  durationMs: number;
}

/**
 * STUB: returns null until the sidecar exposes an "emotion" classify task.
 * Callers already handle null via the rule-based + sentiment fallback.
 */
export async function readNeuralEmotion(_text: string, _timeoutMs?: number): Promise<NeuralEmotionRead | null> {
  return null;
}

/**
 * Blend neural prediction into the existing cues. Each neural score
 * is mixed into the matching cue with `mix` weight; rule-based survives
 * untouched on failure. Returns the adjusted cues object.
 */
export function blendNeuralIntoCues(
  cues: { curiosity: number; warmth: number; playfulness: number; focus: number; wonder: number; frustration: number; calm: number; confidence: number },
  neural: NeuralEmotionRead | null,
  mix = 0.45,
): typeof cues {
  if (!neural) return cues;
  const s = neural.scores;
  const lerp = (a: number, b: number) => clamp(a * (1 - mix) + b * mix, 0, 1);
  return {
    curiosity:   lerp(cues.curiosity,   s.surprise),
    warmth:      lerp(cues.warmth,      s.joy),
    playfulness: lerp(cues.playfulness, s.joy * 0.7 + s.surprise * 0.3),
    focus:       cues.focus,
    wonder:      lerp(cues.wonder,      s.surprise * 0.6),
    frustration: lerp(cues.frustration, Math.max(s.anger, s.disgust) * 0.9 + s.sadness * 0.4),
    calm:        lerp(cues.calm,        s.neutral),
    confidence:  lerp(cues.confidence,  1 - s.fear),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Twitter-style 3-class sentiment + toxicity (separate models) ─────────
//
// The emotion model above is 7-class (anger/joy/sadness/...) trained mostly
// on subtitles. It misses sarcasm and ironic register because the training
// data was earnestly emotional. The Twitter-roberta model below is 3-class
// (negative/neutral/positive) trained on Twitter posts, which are heavily
// sarcastic — so it catches "oh great, just what I needed" as negative
// where the emotion model marks it positive (joy from "great").
//
// Toxicity is the second model — for catching toxic user input (don't
// escalate, lean listening) and for catching toxic assistant output
// before it reaches the user (defensive layer on top of the leak-guard).

import { sentimentPipeline, toxicityPipeline } from "@/lib/ml/transformers-pool";

export interface SentimentRead {
  /** -1 to +1, where +1 is strongly positive, -1 strongly negative */
  polarity: number;
  /** raw label confidence */
  scores: { negative: number; neutral: number; positive: number };
}

export interface ToxicityRead {
  /** Maximum across all toxicity sub-labels: 0 = clean, 1 = strongly toxic */
  score: number;
  /** Per-label scores */
  labels: Record<string, number>;
  flagged: boolean; // true if any sub-label crosses 0.5
}

export async function readNeuralSentiment(text: string, timeoutMs = 2_000): Promise<SentimentRead | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const clf = await sentimentPipeline();
    if (!clf) return null;
    const result = (await Promise.race([
      clf(trimmed.slice(0, 512), { topk: 3 }),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error("sentiment timeout")), timeoutMs)),
    ])) as Array<{ label: string; score: number }> | null;
    if (!result || !Array.isArray(result)) return null;
    const scores = { negative: 0, neutral: 0, positive: 0 };
    for (const r of result) {
      const l = r.label.toLowerCase();
      if (l in scores) (scores as Record<string, number>)[l] = r.score;
    }
    const polarity = scores.positive - scores.negative;
    return { polarity, scores };
  } catch (e) {
    log.warn("sentiment read failed", e);
    return null;
  }
}

export async function readToxicity(text: string, timeoutMs = 2_000): Promise<ToxicityRead | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const clf = await toxicityPipeline();
    if (!clf) return null;
    const result = (await Promise.race([
      clf(trimmed.slice(0, 512), { topk: 6 }),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error("toxicity timeout")), timeoutMs)),
    ])) as Array<{ label: string; score: number }> | null;
    if (!result || !Array.isArray(result)) return null;
    const labels: Record<string, number> = {};
    let max = 0;
    for (const r of result) {
      labels[r.label] = r.score;
      if (r.score > max) max = r.score;
    }
    return { score: max, labels, flagged: max >= 0.5 };
  } catch (e) {
    log.warn("toxicity read failed", e);
    return null;
  }
}

/**
 * Blend BOTH neural emotion AND sentiment polarity into the cues.
 * Sentiment polarity catches sarcasm cases the emotion classifier misses
 * because Twitter-roberta was trained on ironic register.
 */
export function blendAllNeuralIntoCues(
  cues: { curiosity: number; warmth: number; playfulness: number; focus: number; wonder: number; frustration: number; calm: number; confidence: number },
  emotion: NeuralEmotionRead | null,
  sentiment: SentimentRead | null,
  mix = 0.40,
): typeof cues {
  // Start from the emotion-only blend (existing logic)
  let blended = blendNeuralIntoCues(cues, emotion, mix);

  if (sentiment) {
    // Sentiment polarity tugs frustration / warmth toward the right pole.
    // If text is positive: frustration ↓, warmth ↑
    // If text is negative: frustration ↑, warmth ↓ — even if the emotion
    // model said "joy" (sarcasm case).
    const lerp = (a: number, b: number) => clamp(a * (1 - mix * 0.5) + b * (mix * 0.5), 0, 1);
    const negativity = sentiment.scores.negative;
    const positivity = sentiment.scores.positive;
    blended = {
      ...blended,
      frustration: lerp(blended.frustration, negativity),
      warmth:      lerp(blended.warmth,      positivity),
    };
  }

  return blended;
}
