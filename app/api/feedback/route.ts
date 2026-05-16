/**
 * POST /api/feedback
 *
 * Records a thumb up/down. Updates BOTH:
 *   1. The DPO-pair backlog (recordThumb → data/feedback/*.jsonl)
 *   2. The per-thread relationship tensor's trust dimension
 *
 * Body: { threadId, messageId, signal: "up" | "down" }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordThumb } from "@/core/mindees-mind/train/rlhf";
import { recordDistillFeedback } from "@/lib/memory/distill-corpus";
import { getRelationship, applyThumb, persistRelationship } from "@/lib/persona";
import { ThreadIdSchema } from "@/lib/threads/id";

export const runtime = "nodejs";

const BodySchema = z.object({
  threadId: ThreadIdSchema,
  messageId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  signal: z.enum(["up", "down"]),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: "invalid body", detail: String(e) }, { status: 400 });
  }

  // Persist for DPO + relationship-tensor update + distill-corpus filter — in parallel
  const rel = await getRelationship(body.threadId);
  const ts = new Date().toISOString();
  await Promise.all([
    recordThumb({ ...body, createdAt: ts }),
    persistRelationship(applyThumb(rel, body.signal)),
    recordDistillFeedback({ ts, assistantId: body.messageId, signal: body.signal }),
  ]);

  return NextResponse.json({ ok: true });
}
