/**
 * Persistence adapter — bridges the local-filesystem assumption to Vercel's
 * ephemeral /tmp.
 *
 * Modes:
 *   - `local`        Direct disk I/O (dev + self-hosted).
 *   - `vercel-blob`  Hydrate from Blob on first use, periodic flush back.
 *
 * What gets flushed (vercel-blob mode):
 *   - /tmp/lancedb/**                 (vector store)
 *   - /tmp/data/conversations/**      (raw chat transcripts)
 *   - /tmp/data/reflections/**        (distilled insights)
 *   - /tmp/data/feedback/**           (thumb signals)
 *   - /tmp/data/user-models/**        (16-dim user tensors per thread)
 *   - /tmp/data/relationships/**      (4-dim relationship tensors per thread)
 *   - /tmp/data/mood-state.json       (8-dim global mood tensor)
 *   - /tmp/data/persona-drift.json
 *   - /tmp/data/replay-buffer.json
 *   - /tmp/data/system-prompt.json
 *   - /tmp/data/improvement-log.jsonl
 *   - /tmp/data/training-metrics.jsonl
 *   - /tmp/data/eval-log.jsonl
 *
 * Cron flush is best-effort: a single failed upload doesn't break the tick.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { DATA_DIR, CHECKPOINTS_DIR } from "@/lib/paths";
import { createLogger } from "@/lib/logger";

const log = createLogger("persistence");

type Mode = "local" | "vercel-blob" | "turso" | "external";

const MODE = env.MEMORY_PERSISTENCE as Mode;
const LANCEDB_PATH = env.LANCEDB_PATH;

let hydratedOnce = false;

/**
 * Snapshot roots — both ends of the round-trip use these.
 * Each entry maps a local directory to its Blob prefix.
 *
 * **Checkpoints prefix is critical**: the GitHub Actions pretrain run
 * uploads checkpoints/base.bin here, and `getMind()` calls hydrate
 * before loading the checkpoint into the native model. Without this
 * row, a freshly cold-started Vercel function never sees the trained
 * weights and serves random-init output.
 */
const SNAPSHOT_TARGETS: Array<{ localRoot: string; blobPrefix: string }> = [
  { localRoot: LANCEDB_PATH,   blobPrefix: "lancedb" },
  { localRoot: DATA_DIR,       blobPrefix: "data" },
  { localRoot: CHECKPOINTS_DIR, blobPrefix: "checkpoints" },
];

/**
 * Called once at first LanceDB use (or any other persistence-dependent path).
 * Pulls down a prior snapshot if one exists.
 */
export async function ensureLanceDBReady(): Promise<void> {
  if (hydratedOnce) return;
  hydratedOnce = true;

  await mkdir(LANCEDB_PATH, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  switch (MODE) {
    case "local":
    case "external":
      log.info(`persistence: ${MODE} @ ${LANCEDB_PATH}`);
      return;
    case "vercel-blob":
      await hydrateFromBlob();
      return;
    case "turso":
      log.info("persistence: turso — LanceDB local cache only; vectors live in libsql");
      return;
  }
}

/**
 * Called by the cron pipeline AFTER a successful training tick. Snapshots
 * EVERY persistence target back to Blob so the next cold function has
 * the latest persona, memory, conversation, and log files.
 *
 * No-op when not in vercel-blob mode. Returns upload stats so the cron
 * route can surface them in the response — without this, the user has
 * no way to tell from the API whether Blob got hit or whether the
 * flush silently no-op'd.
 */
export interface BlobFlushResult {
  mode: Mode;
  uploaded: number;
  failed: number;
  durationMs: number;
  reason?: string;
}

export async function persistAfterTick(): Promise<BlobFlushResult> {
  const start = Date.now();
  if (MODE !== "vercel-blob") {
    return { mode: MODE, uploaded: 0, failed: 0, durationMs: 0, reason: `MEMORY_PERSISTENCE=${MODE}, not vercel-blob` };
  }
  if (!env.BLOB_READ_WRITE_TOKEN) {
    log.warn("vercel-blob persistence enabled but BLOB_READ_WRITE_TOKEN missing — skipping flush");
    return { mode: MODE, uploaded: 0, failed: 0, durationMs: 0, reason: "BLOB_READ_WRITE_TOKEN missing" };
  }
  let uploaded = 0;
  let failed = 0;
  try {
    const { put } = await import("@vercel/blob");
    for (const { localRoot, blobPrefix } of SNAPSHOT_TARGETS) {
      const files = await walk(localRoot);
      for (const f of files) {
        try {
          const buf = await readFile(f);
          const rel = path.relative(localRoot, f).replace(/\\/g, "/");
          await put(`${blobPrefix}/${rel}`, buf, {
            access: "public",
            token: env.BLOB_READ_WRITE_TOKEN,
            allowOverwrite: true,
          });
          uploaded++;
        } catch (e) {
          failed++;
          log.warn(`flush failed for ${path.relative(process.cwd(), f)}`, e);
        }
      }
    }
    log.info(`vercel-blob: flushed ${uploaded} files (${failed} failed)`);
  } catch (e) {
    log.warn("blob flush failed entirely", e);
    return { mode: MODE, uploaded, failed, durationMs: Date.now() - start, reason: e instanceof Error ? e.message : String(e) };
  }
  return { mode: MODE, uploaded, failed, durationMs: Date.now() - start };
}

/**
 * Quick persona flush — the small JSON/JSONL state files that mutate on
 * every chat turn. Designed to run inside the /api/chat function (after
 * the stream yields its finish event) so Blob populates within seconds
 * of each turn, not only when the cron tick succeeds.
 *
 * **Critical for the self-learning loop**: this is what gets
 * `data/distill-corpus.jsonl` to Blob in time for the weekly pretrain
 * workflow to pull a fresh copy. If a file mutates per-turn AND is
 * needed by the training path, it MUST be in this list (otherwise the
 * GH Action will only see the snapshot from the last successful cron
 * tick, which can be up to 5 min stale).
 */
export async function persistPersonaQuick(): Promise<void> {
  if (MODE !== "vercel-blob") return;
  if (!env.BLOB_READ_WRITE_TOKEN) return;

  const personaRoots = [
    path.join(DATA_DIR, "user-models"),
    path.join(DATA_DIR, "relationships"),
    // v0.2.5+ per-thread tensors
    path.join(DATA_DIR, "theory-of-mind"),
    path.join(DATA_DIR, "vocab-mirror"),
    path.join(DATA_DIR, "inner-voice"),
    path.join(DATA_DIR, "rhythm"),
  ];
  const standaloneFiles = [
    path.join(DATA_DIR, "mood-state.json"),
    path.join(DATA_DIR, "persona-drift.json"),
    path.join(DATA_DIR, "replay-buffer.json"),
    // v0.2.5+ append-style JSONLs & global tensors
    path.join(DATA_DIR, "distill-corpus.jsonl"),     // ← critical for pretrain
    path.join(DATA_DIR, "distill-feedback.jsonl"),   // ← RLHF-lite filter for pretrain
    path.join(DATA_DIR, "journal.jsonl"),
    path.join(DATA_DIR, "corrections.jsonl"),
    path.join(DATA_DIR, "auto-research-log.jsonl"),
    path.join(DATA_DIR, "delights.jsonl"),
    path.join(DATA_DIR, "cron-heartbeat.jsonl"),
    path.join(DATA_DIR, "sleep-cycle.json"),
    path.join(DATA_DIR, "sentiment-arc.json"),
    path.join(DATA_DIR, "topic-affinity.json"),
    path.join(DATA_DIR, "runtime-flags.json"),
    path.join(DATA_DIR, "reach-out.json"),
    path.join(DATA_DIR, "currently-researching.json"),
    path.join(DATA_DIR, "graph.json"),
  ];

  try {
    const { put } = await import("@vercel/blob");
    let total = 0;
    for (const root of personaRoots) {
      const files = await walk(root);
      for (const f of files) {
        try {
          const buf = await readFile(f);
          const rel = path.relative(DATA_DIR, f).replace(/\\/g, "/");
          await put(`data/${rel}`, buf, {
            access: "public",
            token: env.BLOB_READ_WRITE_TOKEN,
            allowOverwrite: true,
          });
          total++;
        } catch (e) {
          log.warn(`persona quick-flush failed for ${f}`, e);
        }
      }
    }
    for (const f of standaloneFiles) {
      if (!existsSync(f)) continue;
      try {
        const buf = await readFile(f);
        const rel = path.relative(DATA_DIR, f).replace(/\\/g, "/");
        await put(`data/${rel}`, buf, {
          access: "public",
          token: env.BLOB_READ_WRITE_TOKEN,
          allowOverwrite: true,
        });
        total++;
      } catch (e) {
        log.warn(`persona quick-flush failed for ${f}`, e);
      }
    }
    if (total > 0) log.info(`persona quick-flush: ${total} files`);
  } catch (e) {
    log.warn("persona quick-flush failed entirely", e);
  }
}

async function hydrateFromBlob(): Promise<void> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    log.warn("vercel-blob persistence enabled but BLOB_READ_WRITE_TOKEN missing — starting empty");
    return;
  }
  try {
    const { list } = await import("@vercel/blob");
    let hydrated = 0;
    let failed = 0;

    for (const { localRoot, blobPrefix } of SNAPSHOT_TARGETS) {
      const { blobs } = await list({ prefix: `${blobPrefix}/`, token: env.BLOB_READ_WRITE_TOKEN });
      if (blobs.length === 0) continue;
      for (const b of blobs) {
        try {
          const target = path.join(localRoot, b.pathname.replace(new RegExp(`^${blobPrefix}/`), ""));
          await mkdir(path.dirname(target), { recursive: true });
          const res = await fetch(b.url);
          if (!res.ok) { failed++; continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          await writeFile(target, buf);
          hydrated++;
        } catch (e) {
          failed++;
          log.warn("hydrate failed for blob", e);
        }
      }
    }
    log.info(`vercel-blob: hydrated ${hydrated} files (${failed} failed)`);
  } catch (e) {
    log.warn("blob hydration failed; starting empty", e);
  }
}

async function walk(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  try {
    const items = await readdir(root, { withFileTypes: true });
    for (const it of items) {
      const full = path.join(root, it.name);
      if (it.isDirectory()) out.push(...(await walk(full)));
      else out.push(full);
    }
  } catch (e) {
    log.warn(`walk ${root} failed`, e);
  }
  return out;
}

void stat;
