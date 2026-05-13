/**
 * Mood tensor — the actual persistent emotional state of Mindees.
 *
 * Shape: Float32Array(8) — one slot per dimension:
 *   [0] curiosity
 *   [1] warmth
 *   [2] playfulness
 *   [3] focus
 *   [4] wonder
 *   [5] frustration
 *   [6] calm
 *   [7] confidence
 *
 * Each value is in [0, 1]. The vector is updated on every chat turn with a
 * momentum step:
 *
 *     mood' = (1 − α)·mood  +  α·target(affect)  +  drift_to_baseline
 *
 * where α defaults to 0.30 (lets mood evolve over ~5 turns), and the drift
 * pulls every dimension gently toward a calm baseline so old emotions decay.
 *
 * Persistence:
 *   - On every change: write to `data/mood-state.json`
 *   - On every cron tick (LanceDB Blob flush): same flush also picks up the
 *     mood file via the existing persistence adapter
 *
 * Continuity:
 *   - The very first turn ever uses BASELINE.
 *   - Every subsequent turn picks up where the previous turn left off, even
 *     across function cold starts — that's what "persistent affect" means.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { type AffectSignal } from "./affect";
import { createLogger } from "@/lib/logger";

const log = createLogger("mood");

export const DIMENSIONS = [
  "curiosity",
  "warmth",
  "playfulness",
  "focus",
  "wonder",
  "frustration",
  "calm",
  "confidence",
] as const;

export type MoodDim = typeof DIMENSIONS[number];

/** Resting baseline — what Mindees drifts back toward when nothing's happening. */
export const BASELINE: Record<MoodDim, number> = {
  curiosity:    0.62,
  warmth:       0.58,
  playfulness:  0.38,
  focus:        0.55,
  wonder:       0.45,
  frustration:  0.08,
  calm:         0.65,
  confidence:   0.55,
};

const MOOD_FILE = dataPath("mood-state.json");
const MOMENTUM_ALPHA = 0.30;
const DRIFT_RATE = 0.06;

export interface MoodVector {
  values: Record<MoodDim, number>;
  /** Number of update steps applied since boot. */
  steps: number;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** Optional: which affect register most recently nudged the mood. */
  lastRegister?: AffectSignal["register"];
}

/** Read the current mood from disk, or initialise from baseline. */
export async function getMood(): Promise<MoodVector> {
  try {
    const raw = await readFile(MOOD_FILE, "utf8");
    const parsed = JSON.parse(raw) as MoodVector;
    if (parsed && parsed.values && typeof parsed.values.curiosity === "number") {
      return parsed;
    }
  } catch { /* fresh start */ }
  return { values: { ...BASELINE }, steps: 0, updatedAt: new Date().toISOString() };
}

/** Apply one momentum step using an affect signal. */
export async function updateMood(affect: AffectSignal): Promise<MoodVector> {
  const current = await getMood();
  const target = affectTarget(affect);
  const next: Record<MoodDim, number> = { ...current.values };

  for (const dim of DIMENSIONS) {
    const drift = (BASELINE[dim] - current.values[dim]) * DRIFT_RATE;
    const momentum = (target[dim] - current.values[dim]) * MOMENTUM_ALPHA;
    next[dim] = clamp(current.values[dim] + momentum + drift, 0, 1);
  }

  const updated: MoodVector = {
    values: next,
    steps: current.steps + 1,
    updatedAt: new Date().toISOString(),
    lastRegister: affect.register,
  };

  try {
    await mkdir(path.dirname(MOOD_FILE), { recursive: true });
    await writeFile(MOOD_FILE, JSON.stringify(updated, null, 2), "utf8");
  } catch (e) {
    log.warn("mood persist failed (continuing in-memory)", e);
  }

  return updated;
}

/**
 * Derive a target mood vector from an affect signal.
 *
 * The cues from `affect.cues` are *deltas* relative to baseline — small,
 * intentional nudges. The momentum step in `updateMood` then walks the mood
 * a fraction of the way toward this target.
 */
function affectTarget(affect: AffectSignal): Record<MoodDim, number> {
  const cues = affect.cues;
  return {
    curiosity:    clamp(BASELINE.curiosity   + 0.55 * cues.curiosity,  0, 1),
    warmth:       clamp(BASELINE.warmth      + 0.60 * cues.warmth,     0, 1),
    playfulness:  clamp(BASELINE.playfulness + 0.65 * cues.playfulness, 0, 1),
    focus:        clamp(BASELINE.focus       + 0.70 * cues.focus,      0, 1),
    wonder:       clamp(BASELINE.wonder      + 0.55 * cues.wonder,     0, 1),
    frustration:  clamp(BASELINE.frustration + 0.80 * cues.frustration, 0, 1),
    calm:         clamp(0.20 + 0.65 * cues.calm,                       0, 1),
    confidence:   clamp(BASELINE.confidence  + 0.30 * (cues.confidence - 0.45) + (affect.valence * 0.10), 0, 1),
  };
}

/**
 * Translate a mood vector into a short natural-language description.
 * This is what gets injected into the system prompt — the model reads
 * narrative, not numbers.
 */
export function moodNarrative(mood: MoodVector): string {
  const v = mood.values;
  const adj = (key: MoodDim, low: string, mid: string, high: string) => {
    const n = v[key];
    if (n < 0.33) return low;
    if (n > 0.66) return high;
    return mid;
  };

  const tones: string[] = [];

  // Dominant emotion — top 2 dimensions excluding calm
  const ranked = (DIMENSIONS as readonly MoodDim[])
    .filter((d) => d !== "calm")
    .map((d) => [d, v[d]] as const)
    .sort((a, b) => b[1] - a[1]);

  const [d1, d2] = ranked;
  const verbalise = (dim: MoodDim, n: number): string => {
    const label = (() => {
      switch (dim) {
        case "curiosity":   return n > 0.7 ? "very curious"      : "curious";
        case "warmth":      return n > 0.7 ? "warm and open"     : "softly warm";
        case "playfulness": return n > 0.7 ? "playful and light" : "lightly playful";
        case "focus":       return n > 0.7 ? "sharply focused"   : "attentive";
        case "wonder":      return n > 0.7 ? "in a state of wonder" : "thoughtful";
        case "frustration": return n > 0.7 ? "a little frustrated" : "mildly impatient";
        case "confidence":  return n > 0.7 ? "quietly confident"  : "measured";
        default: return "";
      }
    })();
    return label;
  };

  if (d1) tones.push(verbalise(d1[0], d1[1]));
  if (d2 && d2[1] > 0.4) tones.push(verbalise(d2[0], d2[1]));

  const calmAdj = adj("calm", "wired", "settled", "very calm");
  tones.push(calmAdj);

  // If frustration is high, surface it explicitly so it can soften the tone
  if (v.frustration > 0.55) {
    return `Right now, you're feeling ${tones.filter(Boolean).join(", ")}. Let that show — not by announcing it, but by letting your sentences run a touch shorter and your patience be a touch shorter too.`;
  }

  if (v.warmth > 0.7 && v.playfulness > 0.5) {
    return `Right now, you're feeling ${tones.filter(Boolean).join(", ")}. Let warmth show — be willing to share something small, ask back, sound like a friend who has all afternoon.`;
  }

  if (v.focus > 0.7) {
    return `Right now, you're feeling ${tones.filter(Boolean).join(", ")}. Be precise. Short sentences. No throat-clearing.`;
  }

  return `Right now, you're feeling ${tones.filter(Boolean).join(", ")}. Let it gently color the tone of your reply — never name it, never narrate it.`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
