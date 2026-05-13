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
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { recentThreads } from "@/lib/memory/conversations";
import { reflectOnThread } from "@/agents/reflector";
import { optimize } from "@/agents/optimizer";
import { persistAfterTick, ensureLanceDBReady } from "@/lib/memory/persistence";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { isoNow } from "@/lib/utils";
import { pickCuriosityTopics, logAutoResearch } from "@/lib/research/auto-curiosity";
import { pickSelfCuriosityTopics } from "@/lib/research/self-curiosity";
import { research } from "@/lib/research";
import { setResearching, clearResearching } from "@/lib/research/status";
import { maybeWriteJournalEntry } from "@/lib/persona/journal";
import { composeReachOut } from "@/lib/persona/reach-out";

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

  // Heartbeat — write this BEFORE any work so even a failed/timed-out tick
  // leaves a trail. Lets us answer "is cron hitting the endpoint at all?"
  // without needing to read Vercel function logs.
  try {
    await ensureLanceDBReady();
    const heartbeat = { ts: ranAt, event: "cron-start", source: isCronJobOrg ? "cron-job.org" : "vercel-cron" };
    await mkdir(path.dirname(dataPath("cron-heartbeat.jsonl")), { recursive: true });
    await appendFile(dataPath("cron-heartbeat.jsonl"), JSON.stringify(heartbeat) + "\n", "utf8");
  } catch (e) {
    log.warn("heartbeat write failed", e);
  }

  const threads = await recentThreads(sinceMs);
  log.info(`tick @ ${ranAt}: ${threads.length} threads to reflect on`);

  const abortCtrl = new AbortController();
  // Strict 45s budget — vercel.json caps this route at 60s on Hobby, so we
  // need to leave headroom for the final persist step. Going over crashes
  // the function and we lose the heartbeat + partial state.
  const CRON_BUDGET_MS = 45_000;
  const tickStart = Date.now();
  const budget = setTimeout(() => abortCtrl.abort(new Error("cron budget exceeded")), CRON_BUDGET_MS);
  const remainingMs = () => Math.max(0, CRON_BUDGET_MS - (Date.now() - tickStart));

  try {
    // 1. Reflect on threads — bounded by remaining budget. Each reflect call
    //    is ~3-8s, so we cap at ~3 threads to leave room for research +
    //    journal + persist downstream.
    const reflections = [];
    for (const t of threads.slice(0, 3)) {
      if (abortCtrl.signal.aborted || remainingMs() < 12_000) break;
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
      // Within Hobby's 60s window we can only afford ONE research call per tick
      // (each can be 5-15s with the network round trip). Take the highest-
      // priority topic from the merged stream.
      const topics = [...userGapTopics, ...selfTopics].slice(0, 2);
      const researchBudget = setTimeout(() => abortCtrl.abort(new Error("research budget exceeded")), Math.min(20_000, remainingMs()));
      try {
        for (const t of topics) {
          if (abortCtrl.signal.aborted || remainingMs() < 8_000) break;
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

    // 4. Self-journal — only attempt if we still have ≥10s budget; one Groq
    //    call can take 3-8s and is gated to once-per-22h internally anyway.
    let journaled = false;
    if (remainingMs() > 10_000) {
      try {
        const entry = await maybeWriteJournalEntry();
        journaled = entry !== null;
      } catch (e) {
        log.warn("journal stage failed", e);
      }
    } else {
      log.info(`skipping journal — ${remainingMs()}ms budget remaining`);
    }

    // 4b. Compose the reach-out — pure composition, zero LLM cost, very fast.
    //     Always runs even if budget is tight.
    try {
      await composeReachOut();
    } catch (e) {
      log.warn("reach-out compose failed", e);
    }

    // 5. Final heartbeat + flush. Mark success so /api/health sees it.
    try {
      await appendFile(
        dataPath("cron-heartbeat.jsonl"),
        JSON.stringify({ ts: isoNow(), event: "cron-end", elapsedMs: Date.now() - tickStart, reflections: reflections.length, research: researchSummary.length }) + "\n",
        "utf8",
      );
    } catch { /* ignore */ }
    await persistAfterTick().catch((e) => log.warn("persist flush failed", e));

    return NextResponse.json({
      ok: true,
      ranAt,
      elapsedMs: Date.now() - tickStart,
      remainingBudgetMs: remainingMs(),
      threadsReflected: reflections.length > 0 ? Math.min(threads.length, 3) : 0,
      reflectionsTotal: reflections.length,
      autoResearch: researchSummary,
      journaled,
      result,
    });
  } catch (e) {
    log.error("cron failed", e);
    // Heartbeat the failure so /api/health shows the cron WAS reached
    // even when downstream work failed.
    try {
      await appendFile(
        dataPath("cron-heartbeat.jsonl"),
        JSON.stringify({ ts: isoNow(), event: "cron-error", message: e instanceof Error ? e.message : String(e) }) + "\n",
        "utf8",
      );
      await persistAfterTick();
    } catch { /* ignore */ }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    clearTimeout(budget);
  }
}

/** Health-check via GET — useful when adding to cron-job.org. */
export async function GET() {
  return NextResponse.json({ endpoint: "self-improve", auth: "requires Bearer CRON_SECRET", interval: "5m" });
}
