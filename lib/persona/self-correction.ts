/**
 * Self-correction memory — the most valuable training signal Mindees can have.
 *
 * Every time the user CORRECTS Mindees ("actually it's X", "no, that's wrong"),
 * the correction is GOLD: it's the user explicitly telling us where Mindees
 * was wrong AND what the right answer is.
 *
 * We persist these corrections at data/corrections.jsonl. The orchestrator
 * surfaces the most recent ones in every system prompt with a strong
 * "you've been corrected on this — DO NOT repeat the mistake" instruction.
 *
 * Detection: the empathy tensor already classifies turns as needs_correction.
 * When that fires, we extract the user's message + the *previous* assistant
 * reply (which is what they're correcting) and record the pair.
 *
 * Cost: free (just JSONL append).
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("corrections.jsonl");

export interface Correction {
  ts: string;
  threadId: string;
  wrong_reply: string;       // the assistant reply that got corrected
  user_correction: string;   // the user's correcting message
  topic_hint?: string;       // optional short topic extraction
}

export async function recordCorrection(c: Omit<Correction, "ts">): Promise<void> {
  const row: Correction = { ts: new Date().toISOString(), ...c };
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await appendFile(FILE, JSON.stringify(row) + "\n", "utf8");
  } catch { /* ignore */ }
}

export async function recentCorrections(limit = 6): Promise<Correction[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines
      .slice(-limit * 2)
      .map((l) => {
        try { return JSON.parse(l) as Correction; } catch { return null; }
      })
      .filter((c): c is Correction => c !== null)
      .slice(-limit);
  } catch {
    return [];
  }
}

export function correctionsNarrative(c: Correction[]): string {
  if (c.length === 0) return "";
  const lines = c
    .slice(-4)
    .map((r, i) => {
      const wrong = r.wrong_reply.length > 120 ? r.wrong_reply.slice(0, 117) + "…" : r.wrong_reply;
      const fix = r.user_correction.length > 200 ? r.user_correction.slice(0, 197) + "…" : r.user_correction;
      return `${i + 1}. You said: "${wrong}"\n   They corrected: "${fix}"`;
    })
    .join("\n\n");
  return `# Past corrections — DO NOT REPEAT THESE MISTAKES\n\n${lines}\n\nReferencing one of these earlier mistakes when relevant is good ("I had this wrong earlier, the correct answer is…"). NEVER repeat the wrong claim.`;
}
