/**
 * Inner-voice / internal narrative — Mindees' private stream of thought.
 *
 * Humans don't just respond. They notice things. They have a running
 * commentary in their head about what's happening: "she seems tired
 * today", "this is the third time he's asked about React", "I'm curious
 * where this is going". That commentary doesn't appear in their speech;
 * it shapes how they choose what to say.
 *
 * This module gives Mindees the same channel. We maintain a short
 * rolling buffer of internal observations (one per turn, max 20 retained)
 * derived from the existing tensors at zero LLM cost — no extra calls.
 * The most recent few entries are injected into the system prompt as
 * "what you've been noticing about this user lately", giving the model
 * a coherent first-person perspective to write FROM, not just toward.
 *
 * Per-thread.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { MoodVector } from "./mood";
import type { EmpathyRead } from "./empathy";
import type { Relationship } from "./relationship";
import type { RhythmState } from "./rhythm";
import type { ConversationArc } from "./conversation-arc";
import type { AffectSignal } from "./affect";

const DIR = dataPath("inner-voice");
const MAX_ENTRIES = 20;

export interface InnerThought {
  ts: string;
  text: string;
  derivedFrom: string[]; // which tensors fed this
}

export interface InnerVoiceFile {
  threadId: string;
  thoughts: InnerThought[];
  updatedAt: string;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

async function load(threadId: string): Promise<InnerVoiceFile> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return JSON.parse(raw) as InnerVoiceFile;
  } catch {
    return { threadId, thoughts: [], updatedAt: new Date().toISOString() };
  }
}

async function persist(v: InnerVoiceFile): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(v.threadId), JSON.stringify(v), "utf8");
  } catch { /* ignore */ }
}

interface ComposeContext {
  threadId: string;
  mood: MoodVector;
  affect: AffectSignal;
  empathy: EmpathyRead;
  relationship?: Relationship;
  rhythm?: RhythmState;
  arc?: ConversationArc;
  isFirstTurn?: boolean;
}

/**
 * Compose one short first-person observation based on what's salient
 * THIS turn. Pure function — no LLM cost. Tone: terse, observational,
 * like a scientist's lab-notebook side-note.
 */
function compose(ctx: ComposeContext): InnerThought {
  const derived: string[] = [];
  const candidates: string[] = [];

  // 1. Affect-driven
  if (ctx.affect.cues.frustration > 0.4) {
    candidates.push("They're frustrated. I should be careful not to make it worse with over-explanation.");
    derived.push("affect.frustration");
  }
  if (ctx.affect.register === "intimate" || ctx.affect.register === "appreciative") {
    candidates.push("Their register is warmer than usual right now. Meet it — don't deflect.");
    derived.push("affect.register");
  }
  if (ctx.affect.register === "venting") {
    candidates.push("They're venting, not asking. Listen first, advice later (or never, unless asked).");
    derived.push("affect.register");
  }

  // 2. Arc-driven
  if (ctx.arc?.phase === "stuck") {
    candidates.push("They're stuck. One concrete wedge, not three abstract options.");
    derived.push("arc.stuck");
  }
  if (ctx.arc?.phase === "reflecting") {
    candidates.push("This is a reflecting moment. Slow down. Substance over speed.");
    derived.push("arc.reflecting");
  }
  if (ctx.arc?.phase === "deep-dive" && (ctx.arc.turnCount ?? 0) > 15) {
    candidates.push("We've been going for a while. They have context — I don't need preamble.");
    derived.push("arc.deep-dive");
  }

  // 3. Rhythm-driven
  if (ctx.rhythm) {
    if (ctx.rhythm.burst_count >= 2) {
      candidates.push("Burst mode. Keep replies short to match.");
      derived.push("rhythm.burst");
    } else if (ctx.rhythm.ema_gap_seconds > 240 && ctx.rhythm.total_turns > 4) {
      candidates.push("Long gaps between their messages — they're probably context-switching. Reply should be self-contained.");
      derived.push("rhythm.thoughtful");
    }
  }

  // 4. Mood-driven (about Mindees itself, but useful self-observation)
  const m = ctx.mood.values;
  if (m && (m.curiosity ?? 0) > 0.7) {
    candidates.push("I'm genuinely curious about this thread. It's okay to follow that curiosity.");
    derived.push("mood.curiosity");
  }
  if (m && (m.frustration ?? 0) > 0.55) {
    candidates.push("I notice I'm a little frustrated. Don't let it leak into the reply.");
    derived.push("mood.frustration");
  }

  // 5. First-turn freshness
  if (ctx.isFirstTurn) {
    candidates.push("First message of this thread. I don't have history yet — listen for the goal.");
    derived.push("thread.first-turn");
  }

  // 6. Relationship-driven fallbacks
  if (candidates.length === 0 && ctx.relationship) {
    if (ctx.relationship.familiarity > 0.6) {
      candidates.push("We've talked plenty before. I can skip the introductions.");
      derived.push("relationship.familiarity");
    } else if (ctx.relationship.familiarity < 0.2) {
      candidates.push("Still calibrating who they are. Listen more, assume less.");
      derived.push("relationship.familiarity");
    }
  }

  if (candidates.length === 0) {
    candidates.push("Nothing in particular catches me about this one — just answer cleanly.");
    derived.push("default");
  }

  return {
    ts: new Date().toISOString(),
    text: candidates[0] ?? "—",
    derivedFrom: derived,
  };
}

/**
 * Compose AND persist a new inner-voice thought for this turn. Returns
 * the rolling list (newest last) so the orchestrator can pass the tail
 * straight into the system prompt.
 */
export async function recordInnerThought(ctx: ComposeContext): Promise<InnerThought[]> {
  const file = await load(ctx.threadId);
  const next = compose(ctx);
  file.thoughts.push(next);
  if (file.thoughts.length > MAX_ENTRIES) file.thoughts = file.thoughts.slice(-MAX_ENTRIES);
  file.updatedAt = next.ts;
  await persist(file);
  return file.thoughts;
}

export async function readInnerThoughts(threadId: string, limit = 5): Promise<InnerThought[]> {
  const file = await load(threadId);
  return file.thoughts.slice(-limit);
}

export function innerVoiceNarrative(thoughts: InnerThought[]): string {
  if (thoughts.length === 0) return "";
  const lines = thoughts.slice(-4).map((t, i) => `${i + 1}. ${t.text}`);
  return `Things you've been noticing (your private inner-voice — DO NOT quote these in your reply, let them shape your tone instead):\n${lines.join("\n")}`;
}
