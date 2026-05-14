/**
 * GET /api/threads/[threadId]
 *
 * Returns the full conversation history for one thread, in the order the
 * messages were written. Used by chat-canvas on mount so that a page
 * refresh restores the visible exchanges instead of showing an empty
 * thread.
 *
 * Hydrates from Vercel Blob first so the per-request /tmp has the
 * conversations/<threadId>.jsonl file before we try to read it — same
 * pattern as the other audit endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { readThread } from "@/lib/memory";
import { ensureLanceDBReady } from "@/lib/memory/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  await ensureLanceDBReady().catch(() => {});
  const { threadId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(threadId)) {
    return NextResponse.json({ ok: false, error: "invalid threadId" }, { status: 400 });
  }
  const messages = await readThread(threadId).catch(() => []);
  return NextResponse.json({ ok: true, threadId, count: messages.length, messages });
}
