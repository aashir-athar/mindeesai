/**
 * GET /api/memory-graph
 *
 * Returns the full knowledge-graph triple store (Mindees' learned facts
 * about the user, the world, the codebase, etc.). Sorted by recency.
 *
 * Useful for the /memory-graph audit page and for debugging "why does
 * Mindees think I prefer Rust to Go" type questions.
 */

import { NextResponse } from "next/server";
import { allTriples } from "@/lib/memory/graph";
import { ensureLanceDBReady } from "@/lib/memory/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureLanceDBReady().catch(() => {});
  const triples = await allTriples();
  // Most recent first
  const sorted = [...triples].sort((a, b) => {
    const ax = a.createdAt || "";
    const bx = b.createdAt || "";
    return bx.localeCompare(ax);
  });
  // Count predicates so the UI can show a frequency histogram
  const byPredicate: Record<string, number> = {};
  const bySubject: Record<string, number> = {};
  for (const t of sorted) {
    byPredicate[t.predicate] = (byPredicate[t.predicate] ?? 0) + 1;
    bySubject[t.subject] = (bySubject[t.subject] ?? 0) + 1;
  }
  return NextResponse.json({
    ok: true,
    count: sorted.length,
    triples: sorted.slice(0, 500),
    byPredicate,
    bySubject,
  });
}
