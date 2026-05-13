/**
 * GET /api/research-now
 *
 * Returns the in-flight auto-research beacon, if one is currently active.
 * The chat UI polls this every few seconds to surface a soft "Mindees is
 * thinking about X right now" indicator.
 */

import { NextResponse } from "next/server";
import { getResearching } from "@/lib/research/status";
import { ensureLanceDBReady } from "@/lib/memory/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureLanceDBReady().catch(() => {});
  const beacon = await getResearching();
  return NextResponse.json({ ok: true, researching: beacon });
}
