/**
 * RLHF via DPO from user thumb signals.
 *
 * When a user clicks 👍 on assistant message X and 👎 on message Y in the *same*
 * thread (or comparable threads), we have a preference pair (chosen=X, rejected=Y).
 *
 * We don't train a reward model. We use Direct Preference Optimisation: the
 * model becomes its own implicit reward via the chosen−rejected log-prob margin.
 *
 * This module just *builds* the preference batches. The actual gradient step
 * runs inside `train/online.ts` (which knows how to weight chosen / rejected
 * tokens using the signals from `loss.dpoLossSignal`).
 */

import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FEEDBACK_DIR = dataPath("feedback");

export type ThumbEvent = {
  threadId: string;
  messageId: string;
  signal: "up" | "down";
  createdAt: string;
};

export interface PreferencePair {
  prompt: string;
  chosen: string;
  rejected: string;
  weight: number; // 1.0 by default, higher for stronger signals
}

export async function recordThumb(ev: ThumbEvent): Promise<void> {
  await mkdir(FEEDBACK_DIR, { recursive: true });
  const file = path.join(FEEDBACK_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, JSON.stringify(ev) + "\n", "utf8");
}

export async function buildPreferencePairs(opts: {
  conversationsDir: string;
  maxAgeMs?: number;
}): Promise<PreferencePair[]> {
  try {
    await mkdir(FEEDBACK_DIR, { recursive: true });
    const files = await readdir(FEEDBACK_DIR);
    const events: ThumbEvent[] = [];
    const cutoff = Date.now() - (opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);
    for (const f of files) {
      const txt = await readFile(path.join(FEEDBACK_DIR, f), "utf8");
      for (const line of txt.split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as ThumbEvent;
          if (new Date(e.createdAt).getTime() >= cutoff) events.push(e);
        } catch {
          // skip malformed
        }
      }
    }

    // Group by thread
    const byThread = new Map<string, ThumbEvent[]>();
    for (const e of events) {
      const arr = byThread.get(e.threadId) ?? [];
      arr.push(e);
      byThread.set(e.threadId, arr);
    }

    const pairs: PreferencePair[] = [];
    for (const [threadId, evs] of byThread) {
      const ups = evs.filter((e) => e.signal === "up").map((e) => e.messageId);
      const downs = evs.filter((e) => e.signal === "down").map((e) => e.messageId);
      if (ups.length === 0 || downs.length === 0) continue;

      const messages = await loadThread(opts.conversationsDir, threadId);
      for (const u of ups) {
        for (const d of downs) {
          const chosen = messages.find((m) => m.id === u);
          const rejected = messages.find((m) => m.id === d);
          const prompt = inferPromptFor(messages, chosen?.id ?? rejected?.id ?? "");
          if (chosen && rejected && prompt) {
            pairs.push({
              prompt,
              chosen: chosen.content,
              rejected: rejected.content,
              weight: 1.0,
            });
          }
        }
      }
    }
    return pairs;
  } catch {
    return [];
  }
}

async function loadThread(dir: string, threadId: string): Promise<Array<{ id: string; role: string; content: string }>> {
  try {
    const txt = await readFile(path.join(dir, `${threadId}.jsonl`), "utf8");
    return txt
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((x) => x);
  } catch {
    return [];
  }
}

function inferPromptFor(
  messages: Array<{ id: string; role: string; content: string }>,
  targetId: string,
): string | null {
  const idx = messages.findIndex((m) => m.id === targetId);
  if (idx < 1) return null;
  // walk back to find the most recent user message
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!.content;
  }
  return null;
}
