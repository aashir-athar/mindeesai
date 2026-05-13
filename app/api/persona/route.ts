/**
 * GET /api/persona?threadId=...
 *
 * Returns the full snapshot of Mindees' persistent state for the given thread:
 *   - mood          (global 8-dim)
 *   - userModel     (per-thread 16-dim)
 *   - relationship  (per-thread 4-dim + thumb counts)
 *   - reward        (aggregate predicted thumb probabilities)
 *   - drift         (last fingerprint + re-anchor count)
 *
 * Useful for the chat UI to render a live "Mindees state" sidebar, and for
 * verifying that the persistence layer is actually accumulating data.
 *
 * Public — read-only — no auth.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getMood,
  getUserModel,
  getRelationship,
  predictReward,
} from "@/lib/persona";
import { getDriftState } from "@/lib/persona/drift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId") ?? "default";

  const [mood, userModel, relationship, reward, drift] = await Promise.all([
    getMood(),
    getUserModel(threadId),
    getRelationship(threadId),
    predictReward(),
    getDriftState(),
  ]);

  return NextResponse.json({
    ok: true,
    threadId,
    mood,
    userModel,
    relationship,
    reward,
    drift: {
      lastFingerprint: drift.history.at(-1) ?? null,
      reanchorsTriggered: drift.reanchorsTriggered,
      historyLength: drift.history.length,
    },
  });
}
