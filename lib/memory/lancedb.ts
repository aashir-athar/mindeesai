/**
 * Memory client. Public API unchanged from the legacy in-process LanceDB
 * implementation — every consumer (17 files) keeps working without edits.
 *
 * Internally this is now a thin HTTP shim that delegates to the sidecar
 * service (scripts/sidecar/, hosted on HF Spaces). LanceDB binaries no
 * longer ship in the main app's deploy because Cloudflare Workers can't
 * load them.
 *
 * When SIDECAR_URL is unset, every call returns empty / no-op with a
 * one-time warning. Set SIDECAR_URL + SIDECAR_AUTH_TOKEN to enable
 * memory (required for Workers; recommended elsewhere).
 */

import {
  isSidecarConfigured,
  sidecarRecall,
  sidecarRecallInsights,
  sidecarRemember,
  sidecarPromoteInsights,
} from "@/lib/sidecar/client";
import { createLogger } from "@/lib/logger";
import type { MemoryRecord, RetrievalHit } from "@/lib/types";

const log = createLogger("memory");

let warnedMissingSidecar = false;
function warnOnce() {
  if (warnedMissingSidecar) return;
  warnedMissingSidecar = true;
  log.warn(
    "SIDECAR_URL not configured — memory writes/reads are no-ops. " +
    "Run `npm --prefix scripts/sidecar start` locally or set SIDECAR_URL in env.",
  );
}

/** Insert a memory. Embeds happen inside the sidecar. */
export async function rememberMany(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  if (!isSidecarConfigured()) {
    warnOnce();
    return;
  }
  await sidecarRemember({ records, table: "memories" });
}

/** Top-K retrieval over the memories table. */
export async function recall(query: string, k = 8, threadId?: string): Promise<RetrievalHit[]> {
  if (!isSidecarConfigured()) {
    warnOnce();
    return [];
  }
  const hits = await sidecarRecall({ query, k, threadId, table: "memories" });
  return (hits as RetrievalHit[] | null) ?? [];
}

/** Top-K retrieval over the insights table. */
export async function recallInsights(query: string, k = 5): Promise<RetrievalHit[]> {
  if (!isSidecarConfigured()) {
    warnOnce();
    return [];
  }
  const hits = await sidecarRecallInsights({ query, k });
  return (hits as RetrievalHit[] | null) ?? [];
}

/** Insert promoted insights. */
export async function promoteInsights(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  if (!isSidecarConfigured()) {
    warnOnce();
    return;
  }
  await sidecarPromoteInsights({ records, table: "insights" });
}

/** Health check used at bootstrap. */
export async function lancedbHealth(): Promise<{ ok: boolean; tables: string[] }> {
  if (!isSidecarConfigured()) {
    return { ok: false, tables: [] };
  }
  // The sidecar's /health includes lancedb status; fetch it directly.
  try {
    const res = await fetch(`${process.env.SIDECAR_URL?.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { ok: false, tables: [] };
    const data = (await res.json()) as { lancedb?: { ok: boolean; tables: string[] } };
    return data.lancedb ?? { ok: false, tables: [] };
  } catch (e) {
    log.warn("health check failed", e);
    return { ok: false, tables: [] };
  }
}
