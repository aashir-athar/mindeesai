/**
 * GET /api/benchmark
 *
 * Runs the eval harness on the current model and returns a snapshot.
 * Used by the landing-page "Live status" widget and by ops monitoring.
 *
 * Auth: optional Bearer CRON_SECRET — public read is fine since the harness
 * is read-only and bounded in cost. Configure auth in production if needed.
 */

import { NextResponse } from "next/server";
import { runBenchmark } from "@/core/mindees-mind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await runBenchmark();
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
