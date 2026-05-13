/**
 * Resolves the *active* system prompt at request time.
 *
 * Read order:
 *   1. data/system-prompt.json   — rewritten every 5 min by the self-improvement loop
 *   2. lib/prompts/base.ts SEED  — fallback for first boot
 */

import { readFile } from "node:fs/promises";
import { SEED_SYSTEM_PROMPT } from "./base";
import { createLogger } from "@/lib/logger";
import { dataPath } from "@/lib/paths";

const log = createLogger("prompts");

let cache: { prompt: string; mtime: number } | null = null;
const PROMPT_PATH = dataPath("system-prompt.json");

/** Read the active prompt, with in-memory caching keyed by file mtime. */
export async function getActiveSystemPrompt(): Promise<string> {
  try {
    const buf = await readFile(PROMPT_PATH, "utf8");
    const parsed = JSON.parse(buf) as { prompt: string; updatedAt: number };
    if (!cache || cache.mtime !== parsed.updatedAt) {
      cache = { prompt: parsed.prompt, mtime: parsed.updatedAt };
      log.debug("active system prompt refreshed");
    }
    return cache.prompt;
  } catch {
    return SEED_SYSTEM_PROMPT;
  }
}

export { SEED_SYSTEM_PROMPT };
export * from "./reflection";
