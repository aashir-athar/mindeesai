/**
 * GET /api/threads?limit=24
 *
 * Returns the user's most recently active threads, with auto-generated titles
 * and previews. The chat UI uses this for a sidebar / picker. No user-facing
 * thread-management config required.
 */

import { NextRequest, NextResponse } from "next/server";
import { listThreads } from "@/lib/threads/metadata";
import { ensureLanceDBReady } from "@/lib/memory/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureLanceDBReady().catch(() => {});
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "24", 10);
  const threads = await listThreads(Math.min(Math.max(limit, 1), 100));
  return NextResponse.json({ ok: true, threads });
}
