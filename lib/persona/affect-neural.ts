/**
 * Neural emotion classifier — drop-in augmentation for the rule-based
 * AffectSignal.
 *
 * Uses @huggingface/transformers (a.k.a. transformers.js — Xenova's port),
 * which runs ONNX-quantised models entirely in the Node runtime. No GPU
 * required, no external service, completely FREE.
 *
 * Model: ``Xenova/emotion-english-distilroberta-base``
 * 7-class output: anger / disgust / fear / joy / neutral / sadness / surprise.
 *
 * The model + tokenizer is ~83MB compressed. Lazy-loaded on first use so
 * cold starts that never need emotion classification don't pay for it.
 * Subsequent calls reuse the cached pipeline (~5-15ms on modern CPU).
 *
 * On any failure (model fetch blocked, OOM on cold serverless, etc.) the
 * caller falls back to the rule-based AffectSignal unchanged. Never blocks
 * the response path.
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

type Classifier = (input: string, opts?: { topk?: number }) => Promise<Array<{ label: string; score: number }>>;

let classifierP: Promise<Classifier | null> | null = null;

async function getClassifier(): Promise<Classifier | null> {
  if (classifierP) return classifierP;
  classifierP = (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      log.info("loading emotion classifier (lazy, one-time)...");
      const clf = (await pipeline(
        "text-classification",
        "Xenova/emotion-english-distilroberta-base",
        { dtype: "q8" },
      )) as unknown as Classifier;
      log.info("emotion classifier ready");
      return clf;
    } catch (e) {
      log.warn("could not load emotion classifier — falling back to rule-based only", e);
      return null;
    }
  })();
  return classifierP;
}

/**
 * Run the neural classifier over a single user message. Returns null on
 * any failure (caller should fall back to rule-based affect signal).
 */
export async function readNeuralEmotion(text: string, timeoutMs = 2500): Promise<NeuralEmotionRead | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return null;
  const start = performance.now();
  try {
    const clf = await getClassifier();
    if (!clf) return null;
    const result = (await Promise.race([
      clf(trimmed.slice(0, 512), { topk: 7 }),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error("emotion classify timeout")), timeoutMs)),
    ])) as Array<{ label: string; score: number }> | null;
    if (!result || !Array.isArray(result)) return null;

    const scores = {
      anger: 0, disgust: 0, fear: 0, joy: 0, neutral: 0, sadness: 0, surprise: 0,
    } as Record<NeuralEmotion, number>;
    for (const r of result) {
      const label = r.label.toLowerCase() as NeuralEmotion;
      if (label in scores) scores[label] = r.score;
    }
    const top = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral") as NeuralEmotion;
    return { top, scores, durationMs: performance.now() - start };
  } catch (e) {
    log.warn("neural emotion read failed", e);
    return null;
  }
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
