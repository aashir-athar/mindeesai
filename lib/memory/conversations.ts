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

import { appendFile, mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Message } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { dataPath } from "@/lib/paths";
import { env } from "@/lib/env";
import { r2ClientFromEnv, r2DeletePrefix } from "./persistence-r2";

const log = createLogger("conversations");
const DIR = dataPath("conversations");

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
    const parsed = raw
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

    // Dedup by message id. Concurrent appendMessage() calls from two
    // function instances writing to the same threadId can both append the
    // same logical turn (rare, but real on cold-start storms). Last write
    // wins — preserve the most recently appended version of each id so any
    // post-stream content updates take precedence over the initial empty
    // assistant placeholder.
    const seen = new Map<string, number>();
    for (let i = 0; i < parsed.length; i++) seen.set(parsed[i]!.id, i);
    return parsed.filter((m, i) => seen.get(m.id) === i);
  } catch (e: unknown) {
    if (isFsNotFound(e)) return [];
    log.warn(`readThread ${threadId} failed`, e);
    return [];
  }
}

/**
 * Hard-delete every artefact of a thread: the conversation transcript,
 * the per-thread tensor files (user model, relationship, theory-of-mind,
 * vocab mirror, inner voice, rhythm), the rolling summary, and the
 * thread metadata. Wipes BOTH local /tmp (which would be regenerated on
 * the next R2 hydrate) AND the remote R2 store (so the deletion sticks
 * across cold starts).
 *
 * Idempotent — files that don't exist are silently skipped. Returns
 * counts so callers can confirm something actually got wiped.
 */
export async function deleteThread(threadId: string): Promise<{
  localFilesRemoved: number;
  remoteObjectsRemoved: number;
}> {
  const sanitised = threadId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sanitised) {
    return { localFilesRemoved: 0, remoteObjectsRemoved: 0 };
  }

  // Local: every per-thread file lives under one of these directories
  // with the threadId as the filename.
  const perThreadFiles = [
    path.join(DIR, `${sanitised}.jsonl`),
    dataPath("user-models", `${sanitised}.json`),
    dataPath("relationships", `${sanitised}.json`),
    dataPath("theory-of-mind", `${sanitised}.json`),
    dataPath("vocab-mirror", `${sanitised}.json`),
    dataPath("inner-voice", `${sanitised}.json`),
    dataPath("rhythm", `${sanitised}.json`),
    dataPath("thread-summaries", `${sanitised}.json`),
    dataPath("threads", `${sanitised}.json`),
  ];

  let localFilesRemoved = 0;
  for (const f of perThreadFiles) {
    try {
      await unlink(f);
      localFilesRemoved++;
    } catch (e) {
      if (!isFsNotFound(e)) log.warn(`thread-delete: unlink ${f} failed`, e);
    }
  }

  // Remote: walk every R2 prefix that holds per-thread state. We delete
  // by EXACT key (the same shapes persistence.ts uploads), not by prefix,
  // because thread IDs are bounded-length opaque tokens — there's no
  // chance of a "<id>" prefix matching another thread's files.
  let remoteObjectsRemoved = 0;
  if (env.MEMORY_PERSISTENCE === "cloudflare-r2") {
    const client = r2ClientFromEnv();
    if (client) {
      const prefixes = [
        `data/conversations/${sanitised}.jsonl`,
        `data/user-models/${sanitised}.json`,
        `data/relationships/${sanitised}.json`,
        `data/theory-of-mind/${sanitised}.json`,
        `data/vocab-mirror/${sanitised}.json`,
        `data/inner-voice/${sanitised}.json`,
        `data/rhythm/${sanitised}.json`,
        `data/thread-summaries/${sanitised}.json`,
        `data/threads/${sanitised}.json`,
      ];
      for (const key of prefixes) {
        try {
          const n = await r2DeletePrefix(client, key);
          remoteObjectsRemoved += n;
        } catch (e) {
          log.warn(`thread-delete: r2DeletePrefix ${key} failed`, e);
        }
      }
    }
  }
  // Note: vercel-blob mode is not handled here — that path is legacy and
  // the user has migrated to R2. If someone re-enables Blob we'd need a
  // parallel delete loop against @vercel/blob's `del()`.

  log.info(`thread-delete ${sanitised}: ${localFilesRemoved} local + ${remoteObjectsRemoved} remote`);
  return { localFilesRemoved, remoteObjectsRemoved };
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
