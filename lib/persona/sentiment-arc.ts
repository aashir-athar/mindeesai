/**
 * Sentiment-over-time arc — long-term affect trend toward Mindees.
 *
 * Different from the per-turn `empathy` read and from `mood` (which is
 * Mindees' own state). This is the user's accumulated emotional posture
 * toward Mindees across the whole relationship: warming, cooling,
 * comfortable, frustrated, distant.
 *
 * We maintain an EMA over the per-turn affect signal: positive turns push
 * the arc warmer, negative turns push it cooler. Decays slowly so a
 * single bad turn doesn't reset the whole relationship.
 *
 * Per-user (or per-default-user), not per-thread — this is the *whole*
 * relationship, not the current conversation.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { AffectSignal } from "./affect";

const FILE = dataPath("sentiment-arc.json");

export interface SentimentArc {
  warmth_ema: number;       // -1..+1, EMA of (positive - negative)
  trust_ema: number;        // 0..1, slowly accumulates with non-correcting turns
  frustration_ema: number;  // 0..1, EMA of frustration signal
  turns: number;
  updatedAt: string;
}

const DEFAULT: SentimentArc = {
  warmth_ema: 0,
  trust_ema: 0,
  frustration_ema: 0,
  turns: 0,
  updatedAt: new Date(0).toISOString(),
};

const ALPHA_WARMTH = 0.10;       // moderate decay
const ALPHA_TRUST = 0.04;        // slow — trust accumulates over time
const ALPHA_FRUSTRATION = 0.18;  // faster — frustration spikes are real-time signal

let cache: SentimentArc | null = null;

async function load(): Promise<SentimentArc> {
  if (cache) return cache;
  try {
    const raw = await readFile(FILE, "utf8");
    cache = JSON.parse(raw) as SentimentArc;
  } catch {
    cache = { ...DEFAULT };
  }
  return cache;
}

async function persist(s: SentimentArc): Promise<void> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
    cache = s;
  } catch { /* ignore */ }
}

export async function updateSentimentArc(affect: AffectSignal): Promise<SentimentArc> {
  const cur = await load();
  const positiveSignal = affect.cues.warmth + Math.max(0, affect.valence) - affect.cues.frustration;
  const isAppreciative = affect.register === "appreciative" || affect.register === "intimate";
  const next: SentimentArc = {
    warmth_ema: clamp(cur.warmth_ema + ALPHA_WARMTH * (positiveSignal - cur.warmth_ema), -1, 1),
    trust_ema: clamp(cur.trust_ema + ALPHA_TRUST * ((isAppreciative ? 1 : 0.5) - cur.trust_ema), 0, 1),
    frustration_ema: clamp(cur.frustration_ema + ALPHA_FRUSTRATION * (affect.cues.frustration - cur.frustration_ema), 0, 1),
    turns: cur.turns + 1,
    updatedAt: new Date().toISOString(),
  };
  await persist(next);
  return next;
}

export async function getSentimentArc(): Promise<SentimentArc> {
  return load();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function sentimentArcNarrative(s: SentimentArc): string {
  if (s.turns < 3) return ""; // not enough signal yet
  const parts: string[] = [];

  // Warmth descriptor
  if (s.warmth_ema > 0.45) parts.push("This relationship is WARM and easy — they like talking to you.");
  else if (s.warmth_ema > 0.15) parts.push("This relationship is comfortable, mostly positive.");
  else if (s.warmth_ema > -0.15) parts.push("This relationship is neutral, transactional.");
  else if (s.warmth_ema > -0.45) parts.push("This relationship feels cool — they're a little distant lately.");
  else parts.push("This relationship is COLD right now — they've been frustrated with you.");

  // Trust descriptor
  if (s.trust_ema > 0.6) parts.push("Trust is high — they ask you real things, not test questions.");
  else if (s.trust_ema < 0.25 && s.turns > 10) parts.push("Trust is still tentative — they may be testing you.");

  // Frustration alert
  if (s.frustration_ema > 0.35) {
    parts.push(`Recent frustration level is ${s.frustration_ema.toFixed(2)} — be EXTRA careful not to over-explain, condescend, or hedge.`);
  }

  return parts.join(" ");
}
