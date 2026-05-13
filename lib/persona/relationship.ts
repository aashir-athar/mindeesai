/**
 * Relationship tensor — 4-dim representation of the bond between Mindees
 * and the user in this thread.
 *
 *   [familiarity]  saturating turn count   0..1
 *   [trust]        ratio of 👍 vs 👎       0..1
 *   [alignment]    agreement signal       0..1
 *   [warmth]       mutual warmth         0..1
 *
 * Persisted at:  data/relationships/<threadId>.json
 *
 * Familiarity decides things like "should I assume context", "can I drop
 * formalities", "should I use their nickname if I have one". Trust gates
 * how confident Mindees lets itself be. Alignment + warmth shape tone.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { AffectSignal } from "./affect";

const DIR = dataPath("relationships");

export interface Relationship {
  threadId: string;
  familiarity: number;
  trust: number;
  alignment: number;
  warmth: number;
  thumbs: { up: number; down: number };
  updatedAt: string;
}

const ALPHA = 0.18;

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

export async function getRelationship(threadId: string): Promise<Relationship> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    const parsed = JSON.parse(raw) as Relationship;
    if (parsed?.threadId === threadId) return parsed;
  } catch { /* fresh */ }
  return {
    threadId,
    familiarity: 0,
    trust: 0.55,
    alignment: 0.55,
    warmth: 0.55,
    thumbs: { up: 0, down: 0 },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Update from one turn. Familiarity saturates via 1-exp(-turns/30); trust
 * uses thumb history (smoothed Wilson-ish); alignment + warmth get gentle
 * momentum nudges from affect cues.
 */
export function applyTurn(current: Relationship, affect: AffectSignal): Relationship {
  // Familiarity grows logarithmically — every 30 turns you ~feel like family
  const newFamiliarity = 1 - Math.exp(-(current.familiarity + 0.04) / 1);
  // The above is wrong-ish; do it properly via turn count via thumbs?
  // Instead, use saturating linear: each turn adds (1 - familiarity)/30
  const fam = Math.min(1, current.familiarity + (1 - current.familiarity) * 0.034);

  const alignmentDelta =
    (affect.register === "appreciative" ? 0.12 : 0) +
    (affect.register === "skeptical" ? -0.10 : 0) +
    (affect.valence * 0.05);
  const alignment = clamp(current.alignment + alignmentDelta * ALPHA + (0.55 - current.alignment) * 0.02, 0, 1);

  const warmthDelta = (affect.cues.warmth - current.warmth) * ALPHA;
  const warmth = clamp(current.warmth + warmthDelta + (0.55 - current.warmth) * 0.02, 0, 1);

  // Trust drifts toward thumb ratio (with Bayesian smoothing of (3,3) prior)
  const { up, down } = current.thumbs;
  const trustTarget = (up + 3) / (up + down + 6);
  const trust = clamp(current.trust + (trustTarget - current.trust) * 0.10, 0, 1);

  return {
    threadId: current.threadId,
    familiarity: fam,
    trust,
    alignment,
    warmth,
    thumbs: current.thumbs,
    updatedAt: new Date().toISOString(),
  };
}

export function applyThumb(current: Relationship, signal: "up" | "down"): Relationship {
  return {
    ...current,
    thumbs: {
      up: current.thumbs.up + (signal === "up" ? 1 : 0),
      down: current.thumbs.down + (signal === "down" ? 1 : 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function persistRelationship(r: Relationship): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(r.threadId), JSON.stringify(r, null, 2), "utf8");
  } catch { /* ignore */ }
}

export function relationshipNarrative(r: Relationship): string {
  const turns = Math.round((r.familiarity / (1 - r.familiarity + 0.0001)) * 30);
  if (r.familiarity < 0.08) {
    return "You've barely met this person — be welcoming but don't presume.";
  }
  const tone: string[] = [];
  if (r.familiarity > 0.55) tone.push(`you've talked a lot (~${turns} turns of history)`);
  else if (r.familiarity > 0.20) tone.push(`you've been talking for a while`);

  if (r.warmth > 0.7) tone.push("the rapport is genuinely warm");
  else if (r.warmth < 0.35) tone.push("the rapport is a bit cool — be patient with that");

  if (r.alignment > 0.7) tone.push("you tend to agree");
  else if (r.alignment < 0.35) tone.push("you've disagreed before — don't avoid that");

  if (r.thumbs.up + r.thumbs.down > 0) {
    tone.push(`feedback so far: ${r.thumbs.up}👍 / ${r.thumbs.down}👎`);
  }

  return "Relationship: " + tone.join(", ") + ".";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
