/**
 * Conversation → training-token pipeline.
 *
 * Reads JSONL from `data/conversations/` plus the reflections store, encodes
 * each turn through the BPE tokenizer using a chat-template format, and
 * returns concatenated Int32Array chunks suitable for `onlineTrainStep()`.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { SPECIAL_TOKENS, type BpeTokenizer } from "../tokenizer/bpe";
import { dataPath } from "@/lib/paths";

const CONVERSATIONS_DIR = dataPath("conversations");
const REFLECTIONS_DIR = dataPath("reflections");
const DISTILL_FILE = dataPath("distill-corpus.jsonl");

/** Encode one conversation as a token stream with chat-template specials. */
export function encodeConversation(
  messages: Array<{ role: string; content: string }>,
  tokenizer: BpeTokenizer,
  maxTokens: number,
): Int32Array {
  const out: number[] = [SPECIAL_TOKENS.BOS];
  for (const m of messages) {
    const roleToken =
      m.role === "user" ? SPECIAL_TOKENS.USER :
      m.role === "assistant" ? SPECIAL_TOKENS.ASSISTANT :
      m.role === "tool" ? SPECIAL_TOKENS.TOOL :
      SPECIAL_TOKENS.USER;
    out.push(roleToken);
    const turnIds = tokenizer.encode(m.content);
    for (const id of turnIds) out.push(id);
    out.push(SPECIAL_TOKENS.EOS);
    if (out.length >= maxTokens) break;
  }
  return new Int32Array(out.slice(0, maxTokens));
}

/** Load all conversations modified since `sinceMs` and encode them. */
export async function harvestConversationTokens(opts: {
  tokenizer: BpeTokenizer;
  sinceMs: number;
  maxTokensPerThread: number;
}): Promise<Array<{ threadId: string; tokens: Int32Array }>> {
  try {
    const files = await readdir(CONVERSATIONS_DIR);
    const results: Array<{ threadId: string; tokens: Int32Array }> = [];
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(CONVERSATIONS_DIR, f);
      const s = await stat(full);
      if (s.mtimeMs < opts.sinceMs) continue;
      const raw = await readFile(full, "utf8");
      const messages = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try { return JSON.parse(l) as { role: string; content: string }; } catch { return null; }
        })
        .filter((x): x is { role: string; content: string } => x !== null);
      if (messages.length < 2) continue;
      const tokens = encodeConversation(messages, opts.tokenizer, opts.maxTokensPerThread);
      results.push({ threadId: f.replace(/\.jsonl$/, ""), tokens });
    }
    return results;
  } catch {
    return [];
  }
}

/** Harvest the most recent N rows from the live distill corpus.
 *
 *  This is the gold-quality data path: every chat turn the app served
 *  is recorded with system prompt + user + assistant + mood + goal.
 *  Feeding it back into the online training tick closes the loop —
 *  the next checkpoint inherits the EXACT register the orchestrator
 *  spent so much effort enforcing at inference time.
 */
export async function harvestDistillTokens(opts: {
  tokenizer: BpeTokenizer;
  maxRows: number;
  maxTokens: number;
}): Promise<Int32Array> {
  try {
    const raw = await readFile(DISTILL_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean).slice(-opts.maxRows);
    const out: number[] = [SPECIAL_TOKENS.BOS];
    for (const line of lines) {
      let row: { user?: string; assistant?: string };
      try { row = JSON.parse(line); } catch { continue; }
      if (!row.user || !row.assistant) continue;
      out.push(SPECIAL_TOKENS.USER);
      for (const id of opts.tokenizer.encode(row.user)) out.push(id);
      out.push(SPECIAL_TOKENS.EOS);
      out.push(SPECIAL_TOKENS.ASSISTANT);
      for (const id of opts.tokenizer.encode(row.assistant)) out.push(id);
      out.push(SPECIAL_TOKENS.EOS);
      if (out.length >= opts.maxTokens) break;
    }
    return new Int32Array(out.slice(0, opts.maxTokens));
  } catch {
    return new Int32Array(0);
  }
}

/** Load high-confidence reflections as a flat token stream. */
export async function harvestReflectionTokens(opts: {
  tokenizer: BpeTokenizer;
  minConfidence: number;
  maxTokens: number;
}): Promise<Int32Array> {
  try {
    const files = await readdir(REFLECTIONS_DIR);
    const accepted: string[] = [];
    for (const f of files.sort().reverse()) {
      const raw = await readFile(path.join(REFLECTIONS_DIR, f), "utf8");
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const r = JSON.parse(line) as { insight: string; evidence: string; confidence: number };
          if (r.confidence >= opts.minConfidence) {
            accepted.push(`Insight: ${r.insight}\nEvidence: ${r.evidence}`);
          }
        } catch { /* skip */ }
      }
      if (accepted.length > 50) break;
    }
    const out: number[] = [SPECIAL_TOKENS.BOS];
    for (const text of accepted) {
      const ids = opts.tokenizer.encode(text);
      for (const id of ids) out.push(id);
      out.push(SPECIAL_TOKENS.EOS);
      if (out.length >= opts.maxTokens) break;
    }
    return new Int32Array(out.slice(0, opts.maxTokens));
  } catch {
    return new Int32Array(0);
  }
}
