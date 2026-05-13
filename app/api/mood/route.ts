/**
 * GET /api/mood
 *
 * Returns Mindees' current emotional state vector.
 * Used by the chat UI to surface a subtle mood indicator and by anyone
 * curious about whether the persistence layer is wiring correctly.
 */

import { NextResponse } from "next/server";
import { getMood } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mood = await getMood();
  return NextResponse.json({ ok: true, mood });
}
