/**
 * Persistence adapter — bridges the local-filesystem assumption to Vercel's
 * ephemeral /tmp.
 *
 * Modes:
 *   - `local`          Direct disk I/O (dev + self-hosted).
 *   - `cloudflare-r2`  S3-compatible object storage. Free tier: 10 GB,
 *                      1M writes/mo, 10M reads/mo, $0 egress forever.
 *                      Preferred for production deployments.
 *   - `vercel-blob`    Hydrate from Vercel Blob on first use, periodic
 *                      flush back. Cheap to set up but Hobby plan caps
 *                      at 2k writes/mo which the cron burns through fast.
 *
 * What gets flushed:
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
 * Note: checkpoints live on HuggingFace Hub, not here. The native model
 * loader fetches base.bin from HF on cold start via `model/hf-download.ts`.
 *
 * Flushes are best-effort: a single failed upload doesn't break the tick.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { DATA_DIR } from "@/lib/paths";
import { createLogger } from "@/lib/logger";
import { r2ClientFromEnv, r2Put, r2Get, r2List, type R2Client } from "./persistence-r2";

const log = createLogger("persistence");

type Mode = "local" | "vercel-blob" | "cloudflare-r2" | "turso" | "external";

const MODE = env.MEMORY_PERSISTENCE as Mode;
const LANCEDB_PATH = env.LANCEDB_PATH;

let hydratedOnce = false;

/**
 * Circuit breaker for unrecoverable storage errors.
 *
 * When the backend is permanently unhealthy (Blob suspended for quota,
 * R2 credentials invalid, etc.), every put() will fail with the same
 * error. Without a circuit breaker we'd hammer 30+ doomed network calls
 * per cron tick, burn ~30s per tick on round-trip latency, and bury the
 * actual cause under a stack of identical warnings.
 *
 * The breaker trips on the first unrecoverable error and persists for
 * the lifetime of the Node process — restart `npm run dev` (or
 * redeploy on Vercel) to reset.
 */
let circuitOpen = false;
let circuitReason: string | undefined;

const UNRECOVERABLE_PATTERNS = [
  /store has been suspended/i,
  /store does not exist/i,
  /invalid token/i,
  /unauthorized/i,
  /forbidden/i,
  /access denied/i,
  /invalidaccesskeyid/i,
  /signaturedoesnotmatch/i,
];

function isUnrecoverable(msg: string): boolean {
  return UNRECOVERABLE_PATTERNS.some((re) => re.test(msg));
}

/**
 * Snapshot roots — both ends of the round-trip use these.
 * Checkpoints are NOT here — they live on HuggingFace Hub.
 */
const SNAPSHOT_TARGETS: Array<{ localRoot: string; prefix: string }> = [
  { localRoot: LANCEDB_PATH, prefix: "lancedb" },
  { localRoot: DATA_DIR,     prefix: "data" },
];

// ─── backend abstraction ─────────────────────────────────────────────────

interface Backend {
  label: string;
  put(key: string, body: Buffer): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; getUrl?: string }>>;
  fetch(entry: { key: string; getUrl?: string }): Promise<Buffer | null>;
}

async function getBackend(): Promise<{ backend: Backend | null; reason?: string }> {
  if (MODE === "cloudflare-r2") {
    const client = r2ClientFromEnv();
    if (!client) return { backend: null, reason: "R2 credentials incomplete (need R2_ACCOUNT_ID + R2_BUCKET + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY)" };
    return { backend: r2Backend(client) };
  }
  if (MODE === "vercel-blob") {
    if (!env.BLOB_READ_WRITE_TOKEN) return { backend: null, reason: "BLOB_READ_WRITE_TOKEN missing" };
    return { backend: await blobBackend() };
  }
  return { backend: null, reason: `${MODE} mode — no remote backend` };
}

function r2Backend(client: R2Client): Backend {
  return {
    label: "cloudflare-r2",
    put: (key, body) => r2Put(client, key, body),
    list: async (prefix) => {
      const objects = await r2List(client, prefix);
      return objects.map((o) => ({ key: o.key }));
    },
    fetch: (entry) => r2Get(client, entry.key),
  };
}

async function blobBackend(): Promise<Backend> {
  const { put, list } = await import("@vercel/blob");
  return {
    label: "vercel-blob",
    put: async (key, body) => {
      await put(key, body, {
        access: "public",
        token: env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });
    },
    list: async (prefix) => {
      const { blobs } = await list({ prefix, token: env.BLOB_READ_WRITE_TOKEN });
      return blobs.map((b) => ({ key: b.pathname, getUrl: b.url }));
    },
    fetch: async (entry) => {
      if (!entry.getUrl) return null;
      const res = await fetch(entry.getUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Called once at first LanceDB use (or any other persistence-dependent path).
 * Pulls down a prior snapshot if one exists.
 */
export async function ensureLanceDBReady(): Promise<void> {
  if (hydratedOnce) return;
  hydratedOnce = true;

  // When the sidecar handles LanceDB (Cloudflare Workers deploy or any
  // SIDECAR_URL-configured runtime), the main app neither owns local
  // LanceDB files nor can it write to disk. Skip the hydration dance.
  if (process.env.SIDECAR_URL) {
    log.info("persistence: SIDECAR_URL set — skipping local LanceDB hydration (sidecar owns it)");
    return;
  }

  await mkdir(LANCEDB_PATH, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  if (MODE === "local" || MODE === "external") {
    log.info(`persistence: ${MODE} @ ${LANCEDB_PATH}`);
    return;
  }
  if (MODE === "turso") {
    log.info("persistence: turso — LanceDB local cache only; vectors live in libsql");
    return;
  }
  // cloudflare-r2 or vercel-blob — hydrate from the remote backend
  await hydrateFromBackend();
}

/**
 * Called by the cron pipeline AFTER a successful training tick. Snapshots
 * every persistence target back to the remote backend so the next cold
 * function has the latest persona, memory, conversation, and log files.
 *
 * Returns upload stats so the cron route can surface them in the response —
 * without this, the user has no way to tell from the API whether the
 * remote got hit or whether the flush silently no-op'd.
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
  if (MODE === "local" || MODE === "external" || MODE === "turso") {
    return { mode: MODE, uploaded: 0, failed: 0, durationMs: 0, reason: `MEMORY_PERSISTENCE=${MODE}, no remote flush` };
  }
  if (circuitOpen) {
    return {
      mode: MODE, uploaded: 0, failed: 0, durationMs: Date.now() - start,
      reason: `circuit-open: ${circuitReason ?? "unrecoverable backend error"}`,
    };
  }
  const { backend, reason } = await getBackend();
  if (!backend) return { mode: MODE, uploaded: 0, failed: 0, durationMs: Date.now() - start, reason };

  let uploaded = 0;
  let failed = 0;
  let firstError: string | undefined;
  let firstErrorFile: string | undefined;

  for (const { localRoot, prefix } of SNAPSHOT_TARGETS) {
    const files = await walk(localRoot);
    for (const f of files) {
      try {
        const buf = await readFile(f);
        const rel = path.relative(localRoot, f).replace(/\\/g, "/");
        await backend.put(`${prefix}/${rel}`, buf);
        uploaded++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        if (!firstError) {
          firstError = msg;
          firstErrorFile = path.relative(process.cwd(), f);
        }
        if (isUnrecoverable(msg)) {
          circuitOpen = true;
          circuitReason = msg;
          log.error(`storage circuit OPEN — ${msg}. Skipping remaining files this tick and all subsequent flushes until restart.`);
          return {
            mode: MODE, uploaded, failed, durationMs: Date.now() - start,
            reason: `${msg} (first failure: ${path.relative(process.cwd(), f)}) — circuit opened, restart after fixing`,
          };
        }
        log.warn(`${backend.label} flush failed for ${path.relative(process.cwd(), f)}`, e);
      }
    }
  }

  log.info(`${backend.label}: flushed ${uploaded} files (${failed} failed)`);
  return {
    mode: MODE, uploaded, failed, durationMs: Date.now() - start,
    reason: firstError ? `${firstError}${firstErrorFile ? ` (first failure: ${firstErrorFile})` : ""}` : undefined,
  };
}

/**
 * Quick persona flush — the small JSON/JSONL state files that mutate on
 * every chat turn. Designed to run inside the /api/chat function (after
 * the stream yields its finish event) so the remote populates within
 * seconds of each turn, not only when the cron tick succeeds.
 *
 * **Critical for the self-learning loop**: this is what gets
 * `data/distill-corpus.jsonl` to the remote in time for the weekly
 * pretrain workflow to pull a fresh copy. If a file mutates per-turn
 * AND is needed by the training path, it MUST be in this list.
 */
export async function persistPersonaQuick(): Promise<void> {
  if (MODE === "local" || MODE === "external" || MODE === "turso") return;
  if (circuitOpen) return;

  const { backend } = await getBackend();
  if (!backend) return;

  const personaRoots = [
    // The actual conversation transcripts — written to per turn via
    // appendMessage(). Without this, follow-up questions on a different
    // serverless instance read an empty thread file ('forgot the topic'
    // bug). Must be quick-flushed for intra-session continuity.
    path.join(DATA_DIR, "conversations"),
    // Thread metadata (title, lastActivity, turn count, preview) lives
    // here; touched by the orchestrator on every turn via touchMeta().
    // CRITICAL bug if this is missing: /api/threads listThreads() reads
    // an empty /tmp dir on every cold start and reports "no threads"
    // even though 20+ conversations actually exist.
    path.join(DATA_DIR, "threads"),
    // Rolling per-thread summaries — written every 6 turns past turn 12.
    // Same cold-start vanishing problem if not in this list.
    path.join(DATA_DIR, "thread-summaries"),
    path.join(DATA_DIR, "user-models"),
    path.join(DATA_DIR, "relationships"),
    path.join(DATA_DIR, "theory-of-mind"),
    path.join(DATA_DIR, "vocab-mirror"),
    path.join(DATA_DIR, "inner-voice"),
    path.join(DATA_DIR, "rhythm"),
  ];
  const standaloneFiles = [
    path.join(DATA_DIR, "mood-state.json"),
    path.join(DATA_DIR, "persona-drift.json"),
    path.join(DATA_DIR, "replay-buffer.json"),
    path.join(DATA_DIR, "distill-corpus.jsonl"),     // ← critical for pretrain
    path.join(DATA_DIR, "distill-feedback.jsonl"),   // ← RLHF-lite filter
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

  let total = 0;
  for (const root of personaRoots) {
    if (circuitOpen) return;
    const files = await walk(root);
    for (const f of files) {
      if (circuitOpen) return;
      try {
        const buf = await readFile(f);
        const rel = path.relative(DATA_DIR, f).replace(/\\/g, "/");
        await backend.put(`data/${rel}`, buf);
        total++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isUnrecoverable(msg)) {
          circuitOpen = true;
          circuitReason = msg;
          log.error(`storage circuit OPEN — ${msg}. Aborting persona quick-flush.`);
          return;
        }
        log.warn(`persona quick-flush failed for ${f}`, e);
      }
    }
  }
  for (const f of standaloneFiles) {
    if (circuitOpen) return;
    if (!existsSync(f)) continue;
    try {
      const buf = await readFile(f);
      const rel = path.relative(DATA_DIR, f).replace(/\\/g, "/");
      await backend.put(`data/${rel}`, buf);
      total++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isUnrecoverable(msg)) {
        circuitOpen = true;
        circuitReason = msg;
        log.error(`storage circuit OPEN — ${msg}. Aborting persona quick-flush.`);
        return;
      }
      log.warn(`persona quick-flush failed for ${f}`, e);
    }
  }
  if (total > 0) log.info(`${backend.label} quick-flush: ${total} files`);
}

// ─── hydration ───────────────────────────────────────────────────────────

async function hydrateFromBackend(): Promise<void> {
  const { backend, reason } = await getBackend();
  if (!backend) {
    log.warn(`${MODE} hydration skipped — ${reason ?? "no backend"}`);
    return;
  }

  let hydrated = 0;
  let failed = 0;

  for (const { localRoot, prefix } of SNAPSHOT_TARGETS) {
    let entries: Array<{ key: string; getUrl?: string }>;
    try {
      entries = await backend.list(`${prefix}/`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isUnrecoverable(msg)) {
        circuitOpen = true;
        circuitReason = msg;
        log.error(`storage circuit OPEN during hydrate — ${msg}`);
        return;
      }
      log.warn(`${backend.label} list ${prefix}/ failed`, e);
      continue;
    }
    if (entries.length === 0) continue;

    for (const entry of entries) {
      try {
        const target = path.join(localRoot, entry.key.replace(new RegExp(`^${prefix}/`), ""));
        await mkdir(path.dirname(target), { recursive: true });
        const buf = await backend.fetch(entry);
        if (!buf) { failed++; continue; }
        await writeFile(target, buf);
        hydrated++;
      } catch (e) {
        failed++;
        log.warn(`hydrate failed for ${entry.key}`, e);
      }
    }
  }
  log.info(`${backend.label}: hydrated ${hydrated} files (${failed} failed)`);
}

// ─── helpers ─────────────────────────────────────────────────────────────

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
