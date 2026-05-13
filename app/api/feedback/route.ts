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
import { getRelationship, applyThumb, persistRelationship } from "@/lib/persona";

export const runtime = "nodejs";

const BodySchema = z.object({
  threadId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(64),
  signal: z.enum(["up", "down"]),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: "invalid body", detail: String(e) }, { status: 400 });
  }

  // Persist for DPO + relationship-tensor update — in parallel
  const rel = await getRelationship(body.threadId);
  await Promise.all([
    recordThumb({ ...body, createdAt: new Date().toISOString() }),
    persistRelationship(applyThumb(rel, body.signal)),
  ]);

  return NextResponse.json({ ok: true });
}
