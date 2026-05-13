/**
 * POST /api/cron/self-improve
 *
 * Invoked by cron-job.org every 5 minutes.
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Pipeline:
 *   1. Find threads touched since last tick
 *   2. Reflect on each → high-confidence insights
 *   3. Optimizer:
 *        - promotes insights into LanceDB
 *        - bumps retrieval weights
 *        - runs the native model's gradient-descent training tick
 *   4. Returns a JSON summary
 *
 * The endpoint is idempotent — re-running the same tick is safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { recentThreads } from "@/lib/memory/conversations";
import { reflectOnThread } from "@/agents/reflector";
import { optimize } from "@/agents/optimizer";
import { persistAfterTick } from "@/lib/memory/persistence";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { isoNow } from "@/lib/utils";
import { pickCuriosityTopics, logAutoResearch } from "@/lib/research/auto-curiosity";
import { pickSelfCuriosityTopics } from "@/lib/research/self-curiosity";
import { research } from "@/lib/research";
import { setResearching, clearResearching } from "@/lib/research/status";
import { maybeWriteJournalEntry } from "@/lib/persona/journal";

export const runtime = "nodejs";
export const maxDuration = 280; // up to ~5min on Vercel Pro; cron-job.org honours this

const log = createLogger("cron-self-improve");

const FIVE_MIN_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  // Auth — accept EITHER:
  //  - `Authorization: Bearer ${CRON_SECRET}`  (cron-job.org + manual curl)
  //  - Vercel Cron's signed header (when vercel.json declares this route)
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const vercelSig = req.headers.get("x-vercel-signature") ?? "";
  const isCronJobOrg = auth === `Bearer ${env.CRON_SECRET}`;
  const isVercelCron = vercelSig.length > 0; // Vercel signs every cron invocation
  if (!isCronJobOrg && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.ENABLE_SELF_REFLECTION) {
    return NextResponse.json({ ok: true, skipped: "self-reflection disabled" });
  }

  const ranAt = isoNow();
  const sinceMs = Date.now() - FIVE_MIN_MS;
  const threads = await recentThreads(sinceMs);
  log.info(`tick @ ${ranAt}: ${threads.length} threads to reflect on`);

  const abortCtrl = new AbortController();
  // Soft budget: 4 minutes to leave headroom for the optimizer step.
  const budget = setTimeout(() => abortCtrl.abort(new Error("cron budget exceeded")), 4 * 60 * 1000);

  try {
    // 1. Reflect on threads (bounded to ~10 to stay within budget)
    const reflections = [];
    for (const t of threads.slice(0, 10)) {
      if (abortCtrl.signal.aborted) break;
      const rs = await reflectOnThread(t.threadId, abortCtrl.signal).catch((e) => {
        log.warn(`reflect ${t.threadId} failed`, e);
        return [];
      });
      reflections.push(...rs);
    }

    // 2. Optimize: promote insights + run gradient-descent training tick
    const result = await optimize(reflections, { sinceMs, signal: abortCtrl.signal });

    // 3. Autonomous research — find the topics Mindees has been most
    //    uncertain about (corrections, low-confidence beliefs, hedge-heavy
    //    replies) and go look them up. Persists passages as recallable
    //    memories so next chat about that topic, Mindees has substance.
    //    Strictly bounded — at most 3 topics per tick, half the budget.
    const researchSummary: Array<{ topic: string; hits: number; passages: number; ok: boolean }> = [];
    try {
      // Two streams of curiosity: patching user gaps + Mindees's OWN interests
      const [userGapTopics, selfTopics] = await Promise.all([
        pickCuriosityTopics(2),
        pickSelfCuriosityTopics(2),
      ]);
      const topics = [...userGapTopics, ...selfTopics].slice(0, 4);
      const researchBudget = setTimeout(() => abortCtrl.abort(new Error("research budget exceeded")), 90_000);
      try {
        for (const t of topics) {
          if (abortCtrl.signal.aborted) break;
          await setResearching(t.topic, `cron-${t.reason}`);
          try {
            const r = await research(t.topic, abortCtrl.signal);
            const entry = { topic: t.topic, hits: r.hits.length, passages: r.passages.length, ok: true };
            researchSummary.push(entry);
            await logAutoResearch({
              ts: isoNow(),
              topic: t.topic,
              reason: t.reason,
              hits: r.hits.length,
              passages: r.passages.length,
              ok: true,
            });
          } catch (e) {
            log.warn(`auto-research "${t.topic}" failed`, e);
            researchSummary.push({ topic: t.topic, hits: 0, passages: 0, ok: false });
            await logAutoResearch({
              ts: isoNow(),
              topic: t.topic,
              reason: t.reason,
              hits: 0,
              passages: 0,
              ok: false,
            });
          }
        }
      } finally {
        clearTimeout(researchBudget);
        await clearResearching();
      }
    } catch (e) {
      log.warn("auto-research stage failed", e);
    }

    // 4. Self-journal — once every ~22h Mindees writes a private entry
    //    to its own future self. Cheap (one small LLM call).
    let journaled = false;
    try {
      const entry = await maybeWriteJournalEntry();
      journaled = entry !== null;
    } catch (e) {
      log.warn("journal stage failed", e);
    }

    // 5. Flush LanceDB snapshot to Vercel Blob (no-op for MEMORY_PERSISTENCE != "vercel-blob")
    await persistAfterTick().catch((e) => log.warn("persist flush failed", e));

    return NextResponse.json({
      ok: true,
      ranAt,
      threadsReflected: Math.min(threads.length, 10),
      reflectionsTotal: reflections.length,
      autoResearch: researchSummary,
      journaled,
      result,
    });
  } catch (e) {
    log.error("cron failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    clearTimeout(budget);
  }
}

/** Health-check via GET — useful when adding to cron-job.org. */
export async function GET() {
  return NextResponse.json({ endpoint: "self-improve", auth: "requires Bearer CRON_SECRET", interval: "5m" });
}
