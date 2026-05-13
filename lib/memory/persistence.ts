/**
 * Persistence adapter — bridges the local-filesystem assumption of LanceDB to
 * the realities of serverless deployment.
 *
 * Modes:
 *   - `local`        Direct disk I/O (dev + self-hosted).
 *   - `vercel-blob`  Hydrate-from-Blob-on-boot, periodic flush-back. Works
 *                    inside a Vercel function that has /tmp scratch space.
 *   - `turso`        Swap the vector store to libsql vector (configured at
 *                    the LanceDB layer; this adapter sets the right path).
 *   - `external`     LANCEDB_PATH points to a network-mounted volume.
 *
 * The actual LanceDB client only sees a local path. This module is what makes
 * that local path *meaningful* on Vercel.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("persistence");

type Mode = "local" | "vercel-blob" | "turso" | "external";

const MODE = env.MEMORY_PERSISTENCE as Mode;
const LANCEDB_PATH = env.LANCEDB_PATH;

let hydratedOnce = false;

/**
 * Called once at first LanceDB use. Ensures the local target directory exists
 * and (in `vercel-blob` mode) hydrates a prior snapshot if one exists.
 */
export async function ensureLanceDBReady(): Promise<void> {
  if (hydratedOnce) return;
  hydratedOnce = true;

  await mkdir(LANCEDB_PATH, { recursive: true });

  switch (MODE) {
    case "local":
    case "external":
      log.info(`persistence: ${MODE} @ ${LANCEDB_PATH}`);
      return;
    case "vercel-blob":
      await hydrateFromBlob();
      return;
    case "turso":
      log.info("persistence: turso — LanceDB still uses local cache; persistent vectors live in libsql");
      return;
  }
}

/**
 * Called by the cron pipeline AFTER a successful training tick. Snapshots the
 * LanceDB folder back to Blob so the next cold function has the latest data.
 */
export async function persistAfterTick(): Promise<void> {
  if (MODE !== "vercel-blob") return;
  if (!env.BLOB_READ_WRITE_TOKEN) {
    log.warn("vercel-blob persistence enabled but BLOB_READ_WRITE_TOKEN missing — skipping flush");
    return;
  }
  try {
    const { put } = await import("@vercel/blob");
    const files = await walk(LANCEDB_PATH);
    log.info(`flushing ${files.length} LanceDB files to Vercel Blob`);
    for (const f of files) {
      const buf = await readFile(f);
      const rel = path.relative(LANCEDB_PATH, f).replace(/\\/g, "/");
      await put(`lancedb/${rel}`, buf, { access: "public", token: env.BLOB_READ_WRITE_TOKEN });
    }
  } catch (e) {
    log.warn("blob flush failed", e);
  }
}

async function hydrateFromBlob(): Promise<void> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    log.warn("vercel-blob persistence enabled but BLOB_READ_WRITE_TOKEN missing — starting empty");
    return;
  }
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: "lancedb/", token: env.BLOB_READ_WRITE_TOKEN });
    if (blobs.length === 0) {
      log.info("vercel-blob: no prior snapshot — fresh start");
      return;
    }
    log.info(`vercel-blob: hydrating ${blobs.length} files`);
    for (const b of blobs) {
      const target = path.join(LANCEDB_PATH, b.pathname.replace(/^lancedb\//, ""));
      await mkdir(path.dirname(target), { recursive: true });
      const res = await fetch(b.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(target, buf);
    }
    log.info("vercel-blob: hydration complete");
  } catch (e) {
    log.warn("blob hydration failed; starting empty", e);
  }
}

async function walk(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const items = await readdir(root, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(root, it.name);
    if (it.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

void stat; // reserved for future use
