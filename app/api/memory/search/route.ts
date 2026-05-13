/**
 * GET /api/memory/search?q=…&k=…
 *
 * Search both the conversation-memories and promoted-insights tables.
 * Used by the chat UI's memory side-panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { recall, recallInsights } from "@/lib/memory/lancedb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const k = parseInt(req.nextUrl.searchParams.get("k") ?? "6", 10);
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const [memories, insights] = await Promise.all([
    recall(q, k).catch(() => []),
    recallInsights(q, Math.max(2, Math.floor(k / 2))).catch(() => []),
  ]);

  return NextResponse.json({ q, memories, insights });
}
