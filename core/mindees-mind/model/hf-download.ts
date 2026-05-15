/**
 * HuggingFace Hub checkpoint downloader.
 *
 * Public-model fetch with a /tmp cache. On Vercel, the first cold-start of
 * a function instance downloads the checkpoint from HF (~350 MB for the
 * home-max variant, ~smaller for other variants), writes it to
 * `/tmp/checkpoints/<file>`, and every subsequent request on that
 * function instance reads the cached file directly.
 *
 * Why HF and not Vercel Blob:
 *   - Unlimited free storage for public models
 *   - Zero egress charges
 *   - No write-quota cliff (the bug that suspended our Blob store)
 *   - Standard URL, no SDK dependency
 *
 * The downloader is concurrency-safe — multiple requests racing to load
 * the model share a single in-flight promise so we never download twice.
 */

import { existsSync } from "node:fs";
import { mkdir, stat, rename, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { checkpointPath } from "@/lib/paths";
import { createLogger } from "@/lib/logger";

const log = createLogger("hf-download");

/** In-flight downloads keyed by target path so concurrent callers share. */
const inflight = new Map<string, Promise<DownloadResult>>();

export interface DownloadResult {
  ok: boolean;
  path: string;
  bytes: number;
  source: "cache" | "hf" | "local";
  reason?: string;
}

/**
 * Ensure the checkpoint file exists locally; download from HF if not.
 *
 * Resolution order:
 *   1. If the target already exists on disk → return immediately (cache).
 *   2. If HF_MODEL_REPO is configured → fetch + atomic-write to target.
 *   3. Otherwise → return `{ ok: false, reason: "no source" }`.
 *
 * Atomic write: streams to `<target>.partial` then renames. Concurrent
 * cold starts won't observe a half-written file.
 */
export async function ensureCheckpoint(
  fileName: string = env.HF_MODEL_FILE,
): Promise<DownloadResult> {
  const target = checkpointPath(fileName);

  if (existsSync(target)) {
    const s = await stat(target).catch(() => null);
    if (s && s.size > 0) {
      return { ok: true, path: target, bytes: s.size, source: "cache" };
    }
  }

  // Deduplicate concurrent downloads — share a single promise.
  const existing = inflight.get(target);
  if (existing) return existing;

  const p = downloadFromHF(fileName, target).finally(() => inflight.delete(target));
  inflight.set(target, p);
  return p;
}

async function downloadFromHF(fileName: string, target: string): Promise<DownloadResult> {
  const repo = env.HF_MODEL_REPO;
  const rev = env.HF_MODEL_REVISION;
  if (!repo) {
    return { ok: false, path: target, bytes: 0, source: "local", reason: "HF_MODEL_REPO not set" };
  }
  const url = `https://huggingface.co/${repo}/resolve/${rev}/${encodeURIComponent(fileName)}?download=true`;
  log.info(`fetching checkpoint from HF: ${url}`);

  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.partial`;

  try {
    const headers: Record<string, string> = { "User-Agent": "MindeesAI/1.0" };
    // If the repo happens to be private, an HF token lets us in. Public
    // repos ignore the header.
    if (env.HF_TOKEN) headers["Authorization"] = `Bearer ${env.HF_TOKEN}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false, path: target, bytes: 0, source: "hf",
        reason: `HF ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
      };
    }
    if (!res.body) {
      return { ok: false, path: target, bytes: 0, source: "hf", reason: "empty response body" };
    }
    // Stream to disk — checkpoints can be hundreds of MB; buffering the
    // whole thing into memory would blow the 1 GB function ceiling on Vercel.
    await pipeline(
      Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>),
      createWriteStream(tmp),
    );
    // Atomic move into place. If anyone is mid-read on a stale `target`,
    // rename on POSIX is atomic; on Windows it'll replace.
    await rename(tmp, target);
    const s = await stat(target);
    log.info(`checkpoint cached @ ${target} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
    return { ok: true, path: target, bytes: s.size, source: "hf" };
  } catch (e) {
    // Clean up the partial file so the next attempt starts fresh.
    try { await unlink(tmp); } catch { /* ignore */ }
    return {
      ok: false, path: target, bytes: 0, source: "hf",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
