/**
 * Thread metadata — per-thread record auto-maintained by the orchestrator.
 *
 *   data/threads/<threadId>.json
 *   {
 *     id, title, createdAt, lastActivity, turns,
 *     preview        — first ~120 chars of the first user message
 *     lastUserMsg    — most recent user message preview
 *     lastAssistantMsg — most recent assistant reply preview
 *   }
 *
 * User never has to set a thread title. Mindees writes one after the first
 * assistant turn via a small Groq call. Subsequent metadata updates are
 * just file touches in the orchestrator.
 */

import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const DIR = dataPath("threads");

export interface ThreadMeta {
  id: string;
  title: string;
  createdAt: string;
  lastActivity: string;
  turns: number;
  preview: string;
  lastUserMsg?: string;
  lastAssistantMsg?: string;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

export async function getMeta(threadId: string): Promise<ThreadMeta | null> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return JSON.parse(raw) as ThreadMeta;
  } catch {
    return null;
  }
}

export async function upsertMeta(meta: ThreadMeta): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(meta.id), JSON.stringify(meta, null, 2), "utf8");
  } catch { /* ignore */ }
}

export async function touchMeta(
  threadId: string,
  patch: Partial<Omit<ThreadMeta, "id" | "createdAt">>,
): Promise<ThreadMeta> {
  const existing = await getMeta(threadId);
  const merged: ThreadMeta = {
    ...(existing ?? {
      id: threadId,
      title: "Untitled thread",
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      turns: 0,
      preview: "",
    }),
    ...patch,
    id: threadId,
    lastActivity: new Date().toISOString(),
  };
  await upsertMeta(merged);
  return merged;
}

/** List recent threads, sorted by lastActivity desc. */
export async function listThreads(limit = 24): Promise<ThreadMeta[]> {
  try {
    await mkdir(DIR, { recursive: true });
    const files = await readdir(DIR);
    const metas: ThreadMeta[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(DIR, f), "utf8");
        metas.push(JSON.parse(raw) as ThreadMeta);
      } catch { /* skip */ }
    }
    metas.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
    return metas.slice(0, limit);
  } catch {
    return [];
  }
}

/** Get the most-recently-active thread ID, or null. */
export async function mostRecentThreadId(): Promise<string | null> {
  const list = await listThreads(1);
  return list[0]?.id ?? null;
}

void stat;
