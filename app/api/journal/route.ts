/**
 * GET /api/journal?limit=30
 *
 * Returns Mindees' own self-reflection journal entries, newest first.
 * Public — these are written for Mindees but they're not secret. Reading
 * them is part of the "audit page" promise of the /dashboard surface.
 */

import { NextResponse } from "next/server";
import { recentJournalEntries } from "@/lib/persona/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitParam) || 30));
  const entries = await recentJournalEntries(limit);
  return NextResponse.json({ ok: true, count: entries.length, entries });
}
