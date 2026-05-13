/**
 * Delights memory — the moments that actually landed.
 *
 * A real friend remembers the joke that made you laugh, the comment that
 * made you feel seen, the recommendation you ended up loving. Mindees
 * has nothing like this — every turn is treated the same as every
 * other, no record of what specifically went RIGHT.
 *
 * This module tracks "delight events": moments where the user's affect
 * spiked positive RIGHT AFTER one of Mindees's replies. The triggers are
 * conservative on purpose — laughter markers, gratitude, explicit
 * "perfect"/"exactly"/"yes!" affirmation, or a sustained warmth swing.
 *
 * Mindees can callback to these moments in future open conversation
 * (rare, restrained — twice per delight max, then it stops). It's the
 * single biggest thing that separates "feels like a friend who remembers"
 * from "feels like a chatbot with goldfish memory".
 *
 * Per-user (not per-thread) — the moments transcend the conversation
 * they happened in.
 */

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { AffectSignal } from "./affect";

const FILE = dataPath("delights.jsonl");
const MAX_RETAINED = 30;
const MAX_RECALLS_PER_DELIGHT = 2;

export interface Delight {
  ts: string;
  threadId: string;
  /** What Mindees said that landed. Truncated to keep file small. */
  mindeesSaid: string;
  /** What the user said right after, signalling the landing. */
  userResponse: string;
  /** Why we think it landed. */
  trigger: "laughter" | "gratitude" | "affirmation" | "warmth-swing";
  /** How many times Mindees has called back to this delight already. */
  recallCount: number;
}

const LAUGHTER = /\b(haha|lol|lmao|rofl|🤣|😂|😆|🙃|hahaha+|hehe|🥲)\b/i;
const GRATITUDE = /\b(thank ?(you|u)|thanks|appreciate it|you'?re the best|grateful|love it|i love (this|that|you))\b/i;
const AFFIRMATION = /\b(perfect|exactly|yes!|that'?s it|nailed it|you nailed|brilliant|chef'?s kiss|spot on|on point|💯)\b/i;

interface DetectInput {
  threadId: string;
  priorMindeesReply: string;
  userResponse: string;
  affect: AffectSignal;
}

/** Decide whether the user's latest message means the prior reply landed. */
export function detectDelight(input: DetectInput): Delight | null {
  if (!input.priorMindeesReply || input.priorMindeesReply.length < 8) return null;
  const r = input.userResponse;
  let trigger: Delight["trigger"] | null = null;
  if (LAUGHTER.test(r)) trigger = "laughter";
  else if (AFFIRMATION.test(r)) trigger = "affirmation";
  else if (GRATITUDE.test(r)) trigger = "gratitude";
  else if (input.affect.cues.warmth > 0.55 && input.affect.cues.frustration < 0.15) trigger = "warmth-swing";
  if (!trigger) return null;

  return {
    ts: new Date().toISOString(),
    threadId: input.threadId,
    mindeesSaid: input.priorMindeesReply.slice(0, 280),
    userResponse: input.userResponse.slice(0, 160),
    trigger,
    recallCount: 0,
  };
}

export async function recordDelight(d: Delight): Promise<void> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await appendFile(FILE, JSON.stringify(d) + "\n", "utf8");
  } catch { /* ignore */ }
}

async function readAll(): Promise<Delight[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    return raw.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as Delight; } catch { return null; }
    }).filter((d): d is Delight => d !== null);
  } catch {
    return [];
  }
}

async function rewriteAll(rows: Delight[]): Promise<void> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    const out = rows.slice(-MAX_RETAINED).map((r) => JSON.stringify(r)).join("\n") + "\n";
    await writeFile(FILE, out, "utf8");
  } catch { /* ignore */ }
}

/**
 * Return the most-callback-able delights — the ones that aren't tapped out
 * yet. Used by the orchestrator when the conversation is in a warm-open
 * phase and a soft callback would feel natural.
 */
export async function callbackableDelights(limit = 3): Promise<Delight[]> {
  const all = await readAll();
  return all
    .filter((d) => d.recallCount < MAX_RECALLS_PER_DELIGHT)
    .sort((a, b) => b.ts.localeCompare(a.ts)) // newest first
    .slice(0, limit);
}

/**
 * Mark a delight as used in a reply (so we don't beat it to death).
 * Called fire-and-forget after Mindees actually weaves a callback in.
 */
export async function markRecalled(delightTs: string): Promise<void> {
  const all = await readAll();
  let touched = false;
  for (const d of all) {
    if (d.ts === delightTs) {
      d.recallCount += 1;
      touched = true;
    }
  }
  if (touched) await rewriteAll(all);
}

export function delightsNarrative(delights: Delight[]): string {
  if (delights.length === 0) return "";
  const lines = delights.slice(0, 3).map((d, i) => {
    return `${i + 1}. You said "${d.mindeesSaid.slice(0, 120)}${d.mindeesSaid.length > 120 ? "…" : ""}" and they responded with ${d.trigger}: "${d.userResponse}"`;
  });
  return [
    `# Moments that landed`,
    ``,
    `Things you've said that earned a real positive reaction from this user.`,
    `Callback to one of these sparingly when the conversation is warm and open —`,
    `like a friend who remembers what made you both laugh. Never reference more`,
    `than one per reply, never force it, never start a reply with one.`,
    ``,
    lines.join("\n"),
  ].join("\n");
}
