/**
 * Reflection storage — JSONL files keyed by date.
 *
 * Each reflection is a {insight, evidence, confidence, retrievalTag} record
 * emitted by the reflector. Stored as JSONL for easy append + grep.
 *
 * High-confidence reflections are *promoted* to the LanceDB `insights` table
 * by the optimizer so they participate in future retrieval.
 */

import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Reflection } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { dataPath } from "@/lib/paths";

const log = createLogger("reflections");
const DIR = dataPath("reflections");

function dateFile() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(DIR, `${d}.jsonl`);
}

export async function recordReflection(r: Reflection): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await appendFile(dateFile(), JSON.stringify(r) + "\n", "utf8");
}

export async function recentReflections(maxAgeMs = 24 * 60 * 60 * 1000): Promise<Reflection[]> {
  try {
    await mkdir(DIR, { recursive: true });
    const files = await readdir(DIR);
    const cutoff = Date.now() - maxAgeMs;
    const out: Reflection[] = [];
    for (const f of files.sort().reverse()) {
      const text = await readFile(path.join(DIR, f), "utf8");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const r = JSON.parse(line) as Reflection;
          if (new Date(r.createdAt).getTime() >= cutoff) out.push(r);
        } catch {
          // skip
        }
      }
      if (out.length > 0) break; // recent days first; stop once we have data
    }
    return out;
  } catch (e) {
    log.warn("recentReflections failed", e);
    return [];
  }
}
