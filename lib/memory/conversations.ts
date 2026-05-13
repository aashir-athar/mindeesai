/**
 * Per-thread JSONL persistence — the *raw* conversation source-of-truth.
 *
 * Why JSONL and not just LanceDB?
 *   - JSONL is human-grep-able. Operators can `tail -f` a thread during dev.
 *   - JSONL survives a corrupted vector index. The vector store is rebuildable;
 *     the conversation is not.
 *   - Append-only writes mean we never lose a message on a crash.
 *
 * One file per thread under data/conversations/<threadId>.jsonl.
 */

import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Message } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("conversations");
const DIR = path.join(process.cwd(), "data", "conversations");

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

function fileFor(threadId: string) {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.jsonl`);
}

export async function appendMessage(threadId: string, message: Message): Promise<void> {
  await ensureDir();
  await appendFile(fileFor(threadId), JSON.stringify(message) + "\n", "utf8");
}

export async function readThread(threadId: string): Promise<Message[]> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Message;
        } catch {
          return null;
        }
      })
      .filter((m): m is Message => m !== null);
  } catch (e: unknown) {
    if (isFsNotFound(e)) return [];
    log.warn(`readThread ${threadId} failed`, e);
    return [];
  }
}

/** Returns all thread files modified since `sinceMs` (used by the cron loop). */
export async function recentThreads(sinceMs: number): Promise<{ threadId: string; mtime: number }[]> {
  await ensureDir();
  const files = await readdir(DIR);
  const out: { threadId: string; mtime: number }[] = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const s = await stat(path.join(DIR, f));
    if (s.mtimeMs >= sinceMs) {
      out.push({ threadId: f.replace(/\.jsonl$/, ""), mtime: s.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function isFsNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT";
}
