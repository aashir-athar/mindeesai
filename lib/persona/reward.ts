/**
 * Reward predictor — given the features of a candidate response, predict
 * P(thumbed_up) and P(thumbed_down) using historical feedback data.
 *
 * v1: simple class-prior estimate with Laplace smoothing. Eventually swap
 * for a logistic regression over a small feature vector (length, citations
 * count, mood-at-time, hour-of-day, etc.) trained from
 * data/feedback/<date>.jsonl events.
 *
 * Once the native model exists and GRPO is on the cron schedule, this
 * function becomes the reward signal for policy-gradient updates.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

export interface RewardEstimate {
  pUp: number;     // probability of 👍
  pDown: number;   // probability of 👎
  /** How many feedback events the estimate is based on. */
  n: number;
  /** Higher = more confident (sub-linear in n). */
  confidence: number;
}

const FEEDBACK_DIR = dataPath("feedback");

let cached: { estimate: RewardEstimate; expiresAt: number } | null = null;
const TTL_MS = 60_000;

export async function predictReward(): Promise<RewardEstimate> {
  if (cached && cached.expiresAt > Date.now()) return cached.estimate;

  let up = 0, down = 0;
  try {
    const files = await readdir(FEEDBACK_DIR);
    for (const f of files) {
      const raw = await readFile(path.join(FEEDBACK_DIR, f), "utf8");
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as { signal?: "up" | "down" };
          if (e.signal === "up") up++;
          else if (e.signal === "down") down++;
        } catch { /* skip */ }
      }
    }
  } catch { /* no feedback yet */ }

  const n = up + down;
  // Laplace smoothing with (1, 1) prior so the estimate is sane at n = 0
  const pUp = (up + 1) / (n + 2);
  const pDown = (down + 1) / (n + 2);
  const confidence = 1 - 1 / (n + 1); // 0 at n=0, asymptotes to 1

  const estimate: RewardEstimate = { pUp, pDown, n, confidence };
  cached = { estimate, expiresAt: Date.now() + TTL_MS };
  return estimate;
}

/** Optional narrative for the system prompt — only useful once n > ~5. */
export function rewardNarrative(r: RewardEstimate): string {
  if (r.n < 5) return "";
  if (r.pDown > 0.5) {
    return `Aggregate user feedback so far skews negative (${r.n} signals, ${Math.round(r.pDown * 100)}% down). Reflect on what's missing and try a different angle.`;
  }
  if (r.pUp > 0.75) {
    return `Aggregate user feedback is strong (${r.n} signals, ${Math.round(r.pUp * 100)}% up). Keep doing what you're doing.`;
  }
  return "";
}
