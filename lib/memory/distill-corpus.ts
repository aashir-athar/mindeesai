/**
 * Distillation corpus collector.
 *
 * Every chat turn becomes one training row in data/distill-corpus.jsonl,
 * stored in the format pretrain.py expects when run with --distill-corpus.
 * The eventual native MindeesAI model is fine-tuned on this exact dataset
 * — meaning it inherits the *Groq teacher's behaviour as filtered through
 * the Mindees persona prompt on YOUR conversations*, not generic internet
 * text. That's how the native model graduates from "random init" to
 * "useful Mindees" without anyone curating a dataset.
 *
 * One JSONL line per turn:
 *   {
 *     ts:        ISO timestamp
 *     threadId:  thread the turn belongs to
 *     system:    the full persona-augmented system prompt at this moment
 *     user:      verbatim user message
 *     assistant: verbatim assistant reply
 *     tools:     names of any tool calls fired (web-search, etc.)
 *     mood:      mood snapshot at time of turn (for conditional generation)
 *     goal:      goal string at time of turn
 *   }
 *
 * Cost: append-only JSONL. ~1KB per turn. 1,000 turns = 1 MB.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { createLogger } from "@/lib/logger";

const log = createLogger("distill-corpus");
const FILE = dataPath("distill-corpus.jsonl");
const FEEDBACK_FILE = dataPath("distill-feedback.jsonl");

export interface DistillRow {
  ts: string;
  /** Stable id of the assistant message — used to match thumb feedback later. */
  assistantId?: string;
  threadId: string;
  system: string;
  user: string;
  assistant: string;
  tools?: string[];
  mood?: Record<string, number>;
  goal?: string;
}

export interface DistillFeedbackEvent {
  ts: string;
  assistantId: string;
  signal: "up" | "down";
}

/**
 * Fire-and-forget append. Quality-gated: drop turns where the assistant
 * said nothing or where the user message is empty (shouldn't happen but
 * defends against accidental noise in the corpus).
 */
export async function appendDistillRow(row: DistillRow): Promise<void> {
  if (!row.user?.trim() || !row.assistant?.trim()) return;
  if (row.assistant.length < 6) return; // skip ack-only replies
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await appendFile(FILE, JSON.stringify(row) + "\n", "utf8");
  } catch (e) {
    log.warn("distill row append failed", e);
  }
}

/**
 * Record thumb feedback against an assistant message id. The Python
 * pretrain loader reads this file and:
 *   - DROPS rows with "down" feedback entirely (don't teach the model the
 *     thing the user said was wrong).
 *   - DUPLICATES rows with "up" feedback (RLHF-lite — the kind of reply
 *     that earned warmth gets sampled more often during pretraining).
 *
 * Untagged rows pass through with normal weight. This is the cleanest
 * way to get RLHF-style filtering without rewriting append-only JSONL.
 */
export async function recordDistillFeedback(ev: DistillFeedbackEvent): Promise<void> {
  try {
    await mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
    await appendFile(FEEDBACK_FILE, JSON.stringify(ev) + "\n", "utf8");
  } catch (e) {
    log.warn("distill feedback append failed", e);
  }
}
