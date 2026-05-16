/**
 * /api/threads/[threadId]
 *
 *   GET    — returns the full conversation history for one thread, in the
 *            order the messages were written. Used by chat-canvas on mount
 *            so a page refresh restores the visible exchanges instead of
 *            showing an empty thread.
 *
 *   DELETE — removes the thread's conversation transcript + every
 *            per-thread tensor file (user-model, relationship, theory-of-
 *            mind, vocab-mirror, inner-voice, rhythm, thread-summary,
 *            metadata) from BOTH local /tmp AND the remote R2/Blob.
 *            Idempotent — deleting an already-deleted thread is a no-op.
 *
 * Hydrates from the remote first so /tmp has the latest state before we
 * try to read or delete from it — same pattern as the other audit
 * endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { readThread, deleteThread } from "@/lib/memory/conversations";
import { ensureLanceDBReady } from "@/lib/memory/persistence";
import { isValidThreadId } from "@/lib/threads/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  await ensureLanceDBReady().catch(() => {});
  const { threadId } = await params;
  if (!isValidThreadId(threadId)) {
    return NextResponse.json({ ok: false, error: "invalid threadId" }, { status: 400 });
  }
  const messages = await readThread(threadId).catch(() => []);
  return NextResponse.json({ ok: true, threadId, count: messages.length, messages });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  await ensureLanceDBReady().catch(() => {});
  const { threadId } = await params;
  if (!isValidThreadId(threadId)) {
    return NextResponse.json({ ok: false, error: "invalid threadId" }, { status: 400 });
  }
  const result = await deleteThread(threadId);
  return NextResponse.json({ ok: true, threadId, ...result });
}
