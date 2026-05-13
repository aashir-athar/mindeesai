/**
 * POST /api/feedback
 *
 * Records a thumb up/down on an assistant message. The next cron tick will
 * pair ups and downs from the same thread into DPO preference samples that
 * directly tune the model's weights.
 *
 * Request:  { threadId, messageId, signal: "up" | "down" }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordThumb } from "@/core/mindees-mind/train/rlhf";

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
  await recordThumb({ ...body, createdAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
