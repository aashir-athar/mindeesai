/**
 * GET /api/research-log
 *
 * Returns the autonomous-research log — every topic Mindees has gone
 * researching on its own during cron ticks. Newest first.
 */

import { NextResponse } from "next/server";
import { readAutoResearchLog } from "@/lib/research/auto-curiosity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(200, Math.max(1, Number(limitParam) || 50));
  const entries = await readAutoResearchLog(limit);
  return NextResponse.json({ ok: true, count: entries.length, entries });
}
