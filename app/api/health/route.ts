/**
 * GET /api/health
 *
 * Aggregates health signals from every subsystem. Used by uptime monitors and
 * the "system status" widget in the UI.
 */

import { NextResponse } from "next/server";
import { lancedbHealth } from "@/lib/memory/lancedb";
import { getRegistry } from "@/lib/connectors/loader";
import { env } from "@/lib/env";
import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { ensureLanceDBReady } from "@/lib/memory/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Race the R2/Blob hydrate against a 4-second cap. /api/health has a 10s
  // maxDuration ceiling on Vercel Hobby; a cold function instance hydrating
  // dozens of files from R2 can easily blow past 7s, which makes the
  // entire endpoint 504 with FUNCTION_INVOCATION_TIMEOUT.
  //
  // What we want instead: best-effort hydrate, but if it's slow, just
  // report whatever's currently in /tmp. The diagnostics will still show
  // the persistence mode and connector count, and operators can read the
  // partial state to figure out what's wrong.
  await Promise.race([
    ensureLanceDBReady().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]);

  const [lance, reg] = await Promise.all([
    lancedbHealth().catch(() => ({ ok: false, tables: 0 })),
    getRegistry().catch(() => new Map<string, unknown>()),
  ]);

  // Improvement log tail — proves the cron has been ticking
  let lastImprovement: unknown = null;
  try {
    const raw = await readFile(dataPath("improvement-log.jsonl"), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    lastImprovement = JSON.parse(lines[lines.length - 1] ?? "null");
  } catch { /* no log yet */ }

  // Cron heartbeat — written at the START of every cron invocation, before
  // any work runs. If lastImprovement is null but lastHeartbeat is recent,
  // the cron IS firing but failing/timing out mid-step. If both are null,
  // the cron has never hit the endpoint at all (config problem on
  // cron-job.org, wrong URL, paused job, etc.).
  let lastHeartbeat: unknown = null;
  let heartbeatCount = 0;
  try {
    const raw = await readFile(dataPath("cron-heartbeat.jsonl"), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    heartbeatCount = lines.length;
    lastHeartbeat = JSON.parse(lines[lines.length - 1] ?? "null");
  } catch { /* no heartbeats yet */ }

  // Training metrics tail
  let lastTrainingTick: unknown = null;
  try {
    const raw = await readFile(dataPath("training-metrics.jsonl"), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    lastTrainingTick = JSON.parse(lines[lines.length - 1] ?? "null");
  } catch { /* no metrics yet */ }

  // Critical for debugging "self-learning is empty": surfaces exactly
  // what each loop has produced so far.
  const checks = await Promise.allSettled([
    readFile(dataPath("distill-corpus.jsonl"), "utf8").then((s) => s.split("\n").filter(Boolean).length),
    readFile(dataPath("journal.jsonl"), "utf8").then((s) => s.split("\n").filter(Boolean).length),
    readFile(dataPath("auto-research-log.jsonl"), "utf8").then((s) => s.split("\n").filter(Boolean).length),
    readFile(dataPath("graph.json"), "utf8").then((s) => {
      try { return (JSON.parse(s).triples ?? []).length; } catch { return 0; }
    }),
    readFile(dataPath("corrections.jsonl"), "utf8").then((s) => s.split("\n").filter(Boolean).length),
    readFile(dataPath("delights.jsonl"), "utf8").then((s) => s.split("\n").filter(Boolean).length),
  ]);
  const counts = {
    distill_rows: checks[0].status === "fulfilled" ? checks[0].value : 0,
    journal_entries: checks[1].status === "fulfilled" ? checks[1].value : 0,
    auto_research_runs: checks[2].status === "fulfilled" ? checks[2].value : 0,
    graph_triples: checks[3].status === "fulfilled" ? checks[3].value : 0,
    corrections: checks[4].status === "fulfilled" ? checks[4].value : 0,
    delights: checks[5].status === "fulfilled" ? checks[5].value : 0,
  };

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    siteUrl: env.SITE_URL,
    memory: lance,
    persistence: {
      mode: env.MEMORY_PERSISTENCE,
      blob_token_present: !!env.BLOB_READ_WRITE_TOKEN,
      on_vercel: process.env.VERCEL === "1",
    },
    connectors: {
      count: reg.size,
      names: [...reg.keys()],
    },
    cron: {
      configured: !!env.CRON_SECRET,
      /**
       * Diagnostic ladder:
       *   heartbeatCount === 0          → cron has NEVER reached endpoint
       *                                     (check cron-job.org config)
       *   lastHeartbeat recent + null
       *      lastImprovement            → cron is firing but timing out
       *                                     mid-step (reduce budget /
       *                                     diagnose Vercel function logs)
       *   lastImprovement recent        → cron is fully working
       */
      heartbeatCount,
      lastHeartbeat,
      lastImprovement,
      lastTrainingTick,
    },
    /**
     * One-glance view of what each self-learning loop has produced.
     * If ALL of these are 0 in prod after you've chatted, the
     * persistence layer isn't doing its job — see `persistence`
     * above to diagnose.
     */
    self_learning_counts: counts,
    features: {
      research: env.ENABLE_WEB_RESEARCH,
      reflection: env.ENABLE_SELF_REFLECTION,
      sandbox: env.ENABLE_CONNECTOR_SANDBOX,
      vision: env.ENABLE_VISION,
    },
  });
}
