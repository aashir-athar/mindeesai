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
import { maybeRunSleepCycle } from "@/lib/memory/sleep-cycle";

export const runtime = "nodejs";
export const maxDuration = 280; // up to ~5min on Vercel Pro; cron-job.org honours this

const log = createLogger("cron-self-improve");

const FIVE_MIN_MS = 5 * 60 * 1000;

async function authorize(req: NextRequest): Promise<{ ok: boolean; source: string }> {
  if (!env.CRON_SECRET) return { ok: false, source: "no-secret-configured" };

  // 1. Authorization: Bearer ... header (standard, preferred)
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${env.CRON_SECRET}`) return { ok: true, source: "header" };

  // 2. Vercel Cron's signed header
  if ((req.headers.get("x-vercel-signature") ?? "").length > 0) {
    return { ok: true, source: "vercel-cron" };
  }

  // 3. Query-parameter fallback — for services where setting a custom
  //    Authorization header is awkward. Accepted keys: token, secret,
  //    cron_secret. Slightly less secure (the secret CAN show up in
  //    URL logs / cron-job.org history), but for single-user free-tier
  //    convenience it's an acceptable tradeoff.
  const url = new URL(req.url);
  const queryToken =
    url.searchParams.get("token") ||
    url.searchParams.get("secret") ||
    url.searchParams.get("cron_secret") || "";
  if (queryToken && timingSafeEqual(queryToken, env.CRON_SECRET)) {
    return { ok: true, source: "query" };
  }

  return { ok: false, source: "rejected" };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isCronJobOrg = auth.source !== "vercel-cron";

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
  // Strict 40s budget — vercel.json caps this route at 60s on Hobby. The
  // 20s headroom is for: final persistAfterTick (5-15s for Blob upload of
  // accumulated state), final heartbeat write, and any unkillable async
  // work in flight. The user's manual GET hit a 504 even with budget=45s
  // before optimize() was budget-aware, so we tighten further.
  const CRON_BUDGET_MS = 40_000;
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

    // 2. Optimize — runs budget-aware. On Hobby (60s ceiling, ~40s budget
    //    remaining here), the heavy selfImproveTick step gets skipped and
    //    only the cheap insight-promotion + weight-bump + decay run.
    //    Heavy training lives in the weekly GH Actions pretrain instead.
    const result = await optimize(reflections, {
      sinceMs,
      signal: abortCtrl.signal,
      budgetMs: Math.max(2_000, remainingMs() - 5_000), // leave 5s for persist + heartbeat
    });

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

    // 4. Self-journal is now invoked from inside optimize() (which gates it
    //    to budget + the existing 22h interval), so the cron route doesn't
    //    need a duplicate call. Reporting whether optimize wrote one.
    const journaled = false; // optimize result carries this; UI doesn't need it duplicated

    // 4b. Compose the reach-out — pure composition, zero LLM cost, very fast.
    //     Always runs even if budget is tight.
    try {
      await composeReachOut();
    } catch (e) {
      log.warn("reach-out compose failed", e);
    }

    // 4c. Sleep-cycle consolidation — once per ~22h, lift recurring topics
    //     across reflections + corrections + delights + affinities into
    //     consolidated semantic insights in LanceDB. Zero LLM cost (pure
    //     aggregation). Internally gated to interval so it's safe to call
    //     every tick — no-ops 99% of the time.
    try {
      if (remainingMs() > 3_000) await maybeRunSleepCycle();
    } catch (e) {
      log.warn("sleep-cycle failed", e);
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

/**
 * GET — same behaviour as POST when authorized, useful for cron services
 * that only support GET (cron-job.org supports both, but some don't).
 * Unauthorized GETs return a small descriptor instead of running.
 */
export async function GET(req: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({
      endpoint: "self-improve",
      auth: "CRON_SECRET not configured on this deployment",
    });
  }
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({
      endpoint: "self-improve",
      auth: "either send 'Authorization: Bearer <CRON_SECRET>' header OR append '?token=<CRON_SECRET>' to the URL",
      interval: "5m via cron-job.org / daily via Vercel Cron",
    });
  }
  // Authorized GET → run the same pipeline as POST. cron-job.org will see a
  // 200 response with the full tick result.
  return POST(req);
}
