/**
 * In-flight research status beacon.
 *
 * The autonomous-research loop (cron tick) and per-turn auto-research can
 * fire fire-and-forget calls that take a few seconds each. While they're
 * running, the chat UI shows a soft "Mindees is thinking about X right
 * now" indicator so the user knows something is happening.
 *
 * Persisted state lives at data/currently-researching.json. Always a
 * single record (or none). Stale records (>2 min old) are ignored —
 * a serverless cold-boot might leave a stale beacon behind.
 */

import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("currently-researching.json");
const STALE_MS = 2 * 60 * 1000;

export interface ResearchBeacon {
  topic: string;
  startedAt: string;
  reason?: string; // "cron-curiosity" | "per-turn-hedge" | etc
}

export async function setResearching(topic: string, reason = "research"): Promise<void> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    const beacon: ResearchBeacon = {
      topic: topic.slice(0, 120),
      startedAt: new Date().toISOString(),
      reason,
    };
    await writeFile(FILE, JSON.stringify(beacon), "utf8");
  } catch { /* ignore */ }
}

export async function clearResearching(): Promise<void> {
  try {
    await unlink(FILE);
  } catch { /* ignore */ }
}

export async function getResearching(): Promise<ResearchBeacon | null> {
  try {
    const raw = await readFile(FILE, "utf8");
    const beacon = JSON.parse(raw) as ResearchBeacon;
    const age = Date.now() - new Date(beacon.startedAt).getTime();
    if (age > STALE_MS) return null;
    return beacon;
  } catch {
    return null;
  }
}
