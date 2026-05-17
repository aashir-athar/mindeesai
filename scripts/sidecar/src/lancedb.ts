/**
 * LanceDB client + table accessors for the sidecar.
 *
 * The DB lives at $SIDECAR_DATA_DIR/lancedb (defaults to /data/sidecar/lancedb
 * on HF Spaces, where /data is the persistent volume).
 */

import path from "node:path";
import fs from "node:fs/promises";
import { embed } from "./embeddings.js";
import type { MemoryRecord, RetrievalHit } from "./types.js";

const DATA_DIR = process.env.SIDECAR_DATA_DIR ?? "/data/sidecar";
const LANCEDB_PATH = path.join(DATA_DIR, "lancedb");

type LancedbModule = typeof import("@lancedb/lancedb");
type LanceConnection = Awaited<ReturnType<LancedbModule["connect"]>>;

let dbPromise: Promise<{ connect: LanceConnection; lib: LancedbModule }> | null = null;

async function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    await fs.mkdir(LANCEDB_PATH, { recursive: true });
    console.log(`[lancedb] opening @ ${LANCEDB_PATH}`);
    const lib = await import("@lancedb/lancedb");
    const connect = await lib.connect(LANCEDB_PATH);
    return { connect, lib };
  })();
  return dbPromise;
}

type TableName = "memories" | "insights" | "research";

async function getOrCreateTable(name: TableName, sample: MemoryRecord) {
  const { connect } = await getDb();
  const names = await connect.tableNames();
  if (names.includes(name)) {
    return connect.openTable(name);
  }
  console.log(`[lancedb] creating table ${name}`);
  return connect.createTable(name, [sample], { mode: "create" });
}

function sampleRecord(r: Partial<MemoryRecord>): MemoryRecord {
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

export async function rememberMany(records: MemoryRecord[], table: TableName = "memories"): Promise<number> {
  if (records.length === 0) return 0;
  for (const r of records) {
    if (!r.vector) r.vector = await embed(r.text);
  }
  const tbl = await getOrCreateTable(table, sampleRecord(records[0]!));
  await tbl.add(records);
  return records.length;
}

export async function recall(
  query: string,
  opts: { k?: number; threadId?: string; table?: TableName } = {},
): Promise<RetrievalHit[]> {
  const { k = 8, threadId, table = "memories" } = opts;
  const vec = await embed(query);
  const tbl = await getOrCreateTable(table, sampleRecord({ text: "", id: "", createdAt: "" }));
  const builder = tbl.search(vec).limit(k);
  if (threadId) builder.where(`threadId = '${threadId.replace(/'/g, "''")}'`);
  const results = (await builder.toArray()) as Array<MemoryRecord & { _distance: number; vector: number[] }>;
  return results.map((r) => ({ ...r, score: 1 - r._distance })) as RetrievalHit[];
}

export async function lancedbHealth(): Promise<{ ok: boolean; tables: string[] }> {
  try {
    const { connect } = await getDb();
    const tables = await connect.tableNames();
    return { ok: true, tables };
  } catch (e) {
    console.error("[lancedb] health failed:", e);
    return { ok: false, tables: [] };
  }
}
