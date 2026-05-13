/**
 * Conversation rhythm — the pace at which the user is talking.
 *
 * Track the gaps between consecutive user messages in a thread. Some
 * users fire bursts of short messages (high cadence); others deliberate
 * for minutes between turns. Mindees should match: lean concise + quick
 * when they're moving fast, lean substantive + reflective when they're
 * slow.
 *
 * Per-thread tensor. Updates on every user message.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const DIR = dataPath("rhythm");

export type RhythmPhase = "burst" | "fast" | "steady" | "slow" | "thoughtful";

export interface RhythmState {
  threadId: string;
  lastUserTs: number; // ms epoch of last user message
  ema_gap_seconds: number; // exponential moving average of inter-message gap
  burst_count: number; // consecutive messages within 10 s
  total_turns: number;
  updatedAt: string;
}

const ALPHA = 0.30;

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

async function load(threadId: string): Promise<RhythmState> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return JSON.parse(raw) as RhythmState;
  } catch {
    return {
      threadId,
      lastUserTs: 0,
      ema_gap_seconds: 60, // assume 1-minute baseline until we have data
      burst_count: 0,
      total_turns: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function persist(s: RhythmState): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(s.threadId), JSON.stringify(s), "utf8");
  } catch { /* ignore */ }
}

export async function updateRhythm(threadId: string, nowMs = Date.now()): Promise<RhythmState> {
  const cur = await load(threadId);
  const gapSec = cur.lastUserTs === 0 ? 60 : Math.max(0.5, (nowMs - cur.lastUserTs) / 1000);
  const ema = cur.lastUserTs === 0 ? gapSec : cur.ema_gap_seconds + ALPHA * (gapSec - cur.ema_gap_seconds);
  const burstCount = gapSec < 10 ? cur.burst_count + 1 : 0;
  const next: RhythmState = {
    threadId,
    lastUserTs: nowMs,
    ema_gap_seconds: ema,
    burst_count: burstCount,
    total_turns: cur.total_turns + 1,
    updatedAt: new Date(nowMs).toISOString(),
  };
  await persist(next);
  return next;
}

export function rhythmPhase(s: RhythmState): RhythmPhase {
  if (s.burst_count >= 2) return "burst";
  if (s.ema_gap_seconds < 20) return "fast";
  if (s.ema_gap_seconds < 90) return "steady";
  if (s.ema_gap_seconds < 300) return "slow";
  return "thoughtful";
}

export function rhythmNarrative(s: RhythmState): string {
  if (s.total_turns < 3) return "";
  const phase = rhythmPhase(s);
  switch (phase) {
    case "burst":
      return `Conversation rhythm: BURST mode — they're firing rapid short messages. Match: keep replies short (1-3 sentences), don't open with framing, don't bullet-list.`;
    case "fast":
      return `Conversation rhythm: FAST — gaps around ${Math.round(s.ema_gap_seconds)}s. Be concise; assume context.`;
    case "steady":
      return `Conversation rhythm: STEADY — natural back-and-forth pace.`;
    case "slow":
      return `Conversation rhythm: SLOW — they're deliberating between messages. Match: take the space to bring substance, not just speed.`;
    case "thoughtful":
      return `Conversation rhythm: THOUGHTFUL — long gaps (${Math.round(s.ema_gap_seconds / 60)}min) between messages. They're probably doing something else between turns; lean toward complete-thought replies they can return to.`;
  }
}
