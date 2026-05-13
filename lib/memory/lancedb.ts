/**
 * LanceDB client + table accessors.
 *
 * LanceDB is embedded — there is no server. The database is a directory on disk
 * (`LANCEDB_PATH`). This gives us:
 *   - Zero-config persistence in dev
 *   - Trivial portability (zip the folder, you have a backup)
 *   - Fast vector + scalar search in the same query
 *
 * Tables:
 *   memories  — every embedded utterance from any conversation
 *   insights  — promoted high-confidence reflections
 *   research  — embedded web-research passages
 *
 * Note: this module is server-only. Importing it from a client component will
 * blow up — `next.config.ts` declares `@lancedb/lancedb` as a server-external
 * package to make this explicit.
 */

import path from "node:path";
import { env } from "@/lib/env";
import { embed } from "@/lib/embeddings";
import { createLogger } from "@/lib/logger";
import type { MemoryRecord, RetrievalHit } from "@/lib/types";

const log = createLogger("lancedb");

type LancedbModule = typeof import("@lancedb/lancedb");

let dbPromise: Promise<{
  connect: ReturnType<LancedbModule["connect"]>;
  lib: LancedbModule;
}> | null = null;

async function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const { ensureLanceDBReady } = await import("./persistence");
    await ensureLanceDBReady();
    const lib = await import("@lancedb/lancedb");
    const dir = path.resolve(env.LANCEDB_PATH);
    log.info(`opening LanceDB @ ${dir}`);
    const connect = await lib.connect(dir);
    return { connect, lib };
  })();
  return dbPromise;
}

async function getOrCreateTable(name: "memories" | "insights" | "research", sample: Record<string, unknown>) {
  const { connect } = await getDb();
  const names = await connect.tableNames();
  if (names.includes(name)) {
    return connect.openTable(name);
  }
  log.info(`creating table ${name}`);
  return connect.createTable(name, [sample], { mode: "create" });
}

// ─────────────────────────────────────────────────────────────────────────────
// public API
// ─────────────────────────────────────────────────────────────────────────────

/** Insert a memory. Embeds the text if no vector was supplied. */
export async function rememberMany(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  // Embed any record missing a vector
  for (const r of records) {
    if (!r.vector) r.vector = await embed(r.text);
  }
  const tbl = await getOrCreateTable("memories", sampleRecord(records[0]!));
  await tbl.add(records);
  log.debug(`stored ${records.length} memories`);
}

/** Top-K retrieval over the memories table. */
export async function recall(query: string, k = 8, threadId?: string): Promise<RetrievalHit[]> {
  const vec = await embed(query);
  const tbl = await getOrCreateTable("memories", sampleRecord({ text: "", id: "", createdAt: "" }));
  const builder = tbl.search(vec).limit(k);
  if (threadId) builder.where(`threadId = '${threadId.replace(/'/g, "''")}'`);
  const results = (await builder.toArray()) as Array<MemoryRecord & { _distance: number }>;
  return results.map((r) => ({ ...r, score: 1 - r._distance }));
}

/** Top-K retrieval over the insights table (promoted reflections). */
export async function recallInsights(query: string, k = 5): Promise<RetrievalHit[]> {
  const vec = await embed(query);
  try {
    const tbl = await getOrCreateTable("insights", sampleRecord({ text: "", id: "", createdAt: "" }));
    const results = (await tbl.search(vec).limit(k).toArray()) as Array<MemoryRecord & { _distance: number }>;
    return results.map((r) => ({ ...r, score: 1 - r._distance }));
  } catch (e) {
    log.warn("recallInsights failed", e);
    return [];
  }
}

/** Insert promoted insights. */
export async function promoteInsights(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  for (const r of records) {
    if (!r.vector) r.vector = await embed(r.text);
    r.source = "insight";
  }
  const tbl = await getOrCreateTable("insights", sampleRecord(records[0]!));
  await tbl.add(records);
  log.info(`promoted ${records.length} insights`);
}

/** Health check used at bootstrap. */
export async function lancedbHealth(): Promise<{ ok: boolean; tables: string[] }> {
  try {
    const { connect } = await getDb();
    const tables = await connect.tableNames();
    return { ok: true, tables };
  } catch (e) {
    log.error("health failed", e);
    return { ok: false, tables: [] };
  }
}

function sampleRecord(r: Partial<MemoryRecord>): MemoryRecord {
  // Provides LanceDB with a typed sample so it can infer schema on table creation.
  return {
    id: r.id ?? "sample",
    text: r.text ?? "",
    vector: r.vector ?? new Array(384).fill(0),
    threadId: r.threadId ?? "",
    role: r.role ?? "user",
    tags: r.tags ?? [],
    source: r.source ?? "conversation",
    createdAt: r.createdAt ?? new Date().toISOString(),
  };
}
