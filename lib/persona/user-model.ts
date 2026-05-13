/**
 * User-model tensor — 16-dim persistent representation of "who Mindees is
 * talking to right now". Updates every turn from text features.
 *
 * Why per-thread (and not per-account)? Until auth lands, a thread is the
 * stablest user identity we have. Once accounts exist, swap the key.
 *
 * Persisted at:  data/user-models/<threadId>.json
 *
 * The values are stored as a regular number[] for JSON-friendliness (a
 * Float32Array round-trips poorly through JSON.stringify); the math is
 * identical to a Float32-backed tensor.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { AffectSignal } from "./affect";

const DIR = dataPath("user-models");

// 16 dimensions — keep the order stable; downstream readers index by position.
export const USER_DIMS = [
  "terseness",         // 0 — prefers short replies?
  "formality",         // 1
  "technical_depth",   // 2
  "humor_appreciation",// 3
  "follow_up_appetite",// 4 — wants the AI to ask follow-up questions
  "self_curiosity",    // 5 — asks Mindees about itself
  "code_focus",        // 6
  "research_focus",    // 7
  "creative_focus",    // 8
  "casual_chat",       // 9
  "patience",          // 10
  "msg_length_avg",    // 11 — normalised 0..1 of running average length
  "caps_emphasis",     // 12
  "emoji_use",         // 13
  "swears",            // 14
  "declared_intent",   // 15 — "I want X to happen"
] as const;

export type UserDim = typeof USER_DIMS[number];

const PRIOR: Record<UserDim, number> = {
  terseness: 0.50, formality: 0.50, technical_depth: 0.50, humor_appreciation: 0.50,
  follow_up_appetite: 0.50, self_curiosity: 0.30, code_focus: 0.30,
  research_focus: 0.30, creative_focus: 0.30, casual_chat: 0.50,
  patience: 0.65, msg_length_avg: 0.30, caps_emphasis: 0.10,
  emoji_use: 0.20, swears: 0.05, declared_intent: 0.30,
};

const ALPHA = 0.08; // slow — user identity evolves over many turns

export interface UserModel {
  threadId: string;
  values: Record<UserDim, number>;
  turns: number;
  updatedAt: string;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

export async function getUserModel(threadId: string): Promise<UserModel> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    const parsed = JSON.parse(raw) as UserModel;
    if (parsed?.values && typeof parsed.values.terseness === "number") return parsed;
  } catch { /* fresh */ }
  return { threadId, values: { ...PRIOR }, turns: 0, updatedAt: new Date().toISOString() };
}

/**
 * Update the user model from one turn's signals. Pure number-crunching — no I/O.
 */
export function applyTurn(
  current: UserModel,
  opts: {
    text: string;
    affect: AffectSignal;
    runningAvgLen: number;
  },
): UserModel {
  const t = opts.text;
  const lower = t.toLowerCase();
  const len = t.length;
  const hasCode = /```|function |const |class |=>|interface |type |fn |def /.test(t);
  const hasResearch = /paper|study|cite|reference|literature|research|hypothesis|theory/.test(lower);
  const hasCreative = /poem|story|design|imagine|write me|draft|brand|tagline/.test(lower);
  const hasCasual = /^(hi|hey|hello|yo|gm|sup)\b/i.test(t.trim()) || /how (are|r) (you|u)/i.test(lower);
  const emojiCount = (t.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const capsHits = (t.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const swearHits = (t.match(/\b(fuck|shit|damn|wtf|hell)\b/gi) ?? []).length;
  const askedForBrevity = /\b(short|brief|concise|tl;?dr|in one (line|sentence))\b/i.test(t);
  const askedForDepth = /\b(explain in detail|deep dive|walk me through|step.by.step|why)\b/i.test(t);
  const selfQuestion = /\b(who are you|what are you|how do you|are you (an? )?ai|do you (feel|think|remember))\b/i.test(lower);
  const intent = /\b(i want|i need|i'd like|please|can you|could you)\b/i.test(lower);
  const formalCues = /\b(furthermore|additionally|regards|sincerely|therefore|moreover)\b/i.test(lower);
  const followUpAsked = (t.match(/\?/g) ?? []).length > 1;
  const humorCue = /\b(haha|lol|lmao|joking|kidding|funny)\b/i.test(lower) || /😂|🤣|😆/.test(t);

  const target: Record<UserDim, number> = {
    terseness:         askedForBrevity ? 1 : (len < 60 ? 0.7 : len > 240 ? 0.25 : 0.5),
    formality:         formalCues ? 0.85 : hasCasual ? 0.15 : 0.5,
    technical_depth:   askedForDepth ? 0.9 : hasCode ? 0.8 : hasResearch ? 0.75 : 0.4,
    humor_appreciation: humorCue ? 0.9 : 0.4,
    follow_up_appetite: followUpAsked ? 0.8 : (opts.affect.register === "intimate" ? 0.7 : 0.4),
    self_curiosity:    selfQuestion ? 0.95 : 0.25,
    code_focus:        hasCode ? 1 : 0.2,
    research_focus:    hasResearch ? 1 : 0.2,
    creative_focus:    hasCreative ? 1 : 0.2,
    casual_chat:       hasCasual ? 0.9 : 0.3,
    patience:          opts.affect.cues.frustration > 0.4 ? 0.25 : 0.7,
    msg_length_avg:    clamp(opts.runningAvgLen / 600, 0, 1),
    caps_emphasis:     clamp(capsHits * 0.25, 0, 1),
    emoji_use:         clamp(emojiCount * 0.4, 0, 1),
    swears:            clamp(swearHits * 0.5, 0, 1),
    declared_intent:   intent ? 0.85 : 0.3,
  };

  const next: Record<UserDim, number> = { ...current.values };
  for (const dim of USER_DIMS) {
    next[dim] = clamp(current.values[dim] * (1 - ALPHA) + target[dim] * ALPHA, 0, 1);
  }

  return {
    threadId: current.threadId,
    values: next,
    turns: current.turns + 1,
    updatedAt: new Date().toISOString(),
  };
}

export async function persistUserModel(model: UserModel): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(model.threadId), JSON.stringify(model, null, 2), "utf8");
  } catch { /* ignore */ }
}

/** Natural-language summary the system prompt can splice in. */
export function userModelNarrative(m: UserModel): string {
  const v = m.values;
  const bits: string[] = [];

  if (v.terseness > 0.65) bits.push("prefers short, direct answers");
  else if (v.terseness < 0.35) bits.push("appreciates thorough, well-developed answers");

  if (v.formality < 0.30) bits.push("very casual register — match it");
  else if (v.formality > 0.75) bits.push("more formal register");

  if (v.technical_depth > 0.65) bits.push("technically sophisticated — assume vocabulary");
  if (v.code_focus > 0.55)     bits.push("works in code");
  if (v.research_focus > 0.55) bits.push("interested in research-mode topics");
  if (v.creative_focus > 0.55) bits.push("works on creative output");
  if (v.casual_chat > 0.6)     bits.push("often opens with small talk");

  if (v.humor_appreciation > 0.65) bits.push("enjoys humor — be allowed to be funny");
  if (v.self_curiosity > 0.6) bits.push("curious about you (Mindees) as a system");
  if (v.emoji_use > 0.5) bits.push("uses emoji — you can too, sparingly");
  if (v.swears > 0.4) bits.push("swears casually — you can match that level if it serves");
  if (v.patience < 0.4) bits.push("low patience right now — be efficient");

  if (m.turns < 3) bits.push("you've only just met (turn " + m.turns + ")");

  if (bits.length === 0) return "";
  return `What you know about this user: ${bits.join("; ")}.`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
