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
import { getSentimentArc } from "@/lib/persona/sentiment-arc";
import { readBeliefs } from "@/lib/persona/theory-of-mind";
import { signatureVocab } from "@/lib/persona/vocab-mirror";
import { recentCorrections } from "@/lib/persona/self-correction";
import { readInnerThoughts } from "@/lib/persona/inner-voice";
import { readAffinities } from "@/lib/persona/topic-affinity";
import { lastJournalEntry } from "@/lib/persona/journal";
import { ensureLanceDBReady } from "@/lib/memory/persistence";
import { isValidThreadId } from "@/lib/threads/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureLanceDBReady().catch(() => {});
  // Reject anything but a syntactically-valid threadId. Previously this
  // silently defaulted to "default" which leaked aggregate global state
  // across users and made every misshapen request appear to "work".
  const rawThreadId = req.nextUrl.searchParams.get("threadId");
  if (!rawThreadId || !isValidThreadId(rawThreadId)) {
    return NextResponse.json(
      { ok: false, error: "threadId query param missing or invalid (must match [a-zA-Z0-9_-]{1,64})" },
      { status: 400 },
    );
  }
  const threadId = rawThreadId;

  const [mood, userModel, relationship, reward, drift, sentimentArc, beliefs, vocabSig, corrections, innerThoughts, affinities, journal] = await Promise.all([
    getMood(),
    getUserModel(threadId),
    getRelationship(threadId),
    predictReward(),
    getDriftState(),
    getSentimentArc().catch(() => null),
    readBeliefs(threadId).catch(() => []),
    signatureVocab(threadId, 14).catch(() => []),
    recentCorrections(6).catch(() => []),
    readInnerThoughts(threadId, 6).catch(() => []),
    readAffinities().catch(() => []),
    lastJournalEntry().catch(() => null),
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
    // v0.2.5+ humanizing tensors
    sentimentArc,
    beliefs: beliefs.slice(0, 20),
    signatureVocab: vocabSig,
    corrections: corrections.slice(0, 6).map((c) => ({
      ts: c.ts,
      wrong: c.wrong_reply.slice(0, 120),
      correction: c.user_correction.slice(0, 200),
    })),
    innerThoughts,
    affinities: affinities.slice(0, 20),
    journalLastEntry: journal,
  });
}
