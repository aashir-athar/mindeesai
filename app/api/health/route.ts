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
  await ensureLanceDBReady().catch(() => {});
  const [lance, reg] = await Promise.all([
    lancedbHealth(),
    getRegistry(),
  ]);

  // Improvement log tail — proves the cron has been ticking
  let lastImprovement: unknown = null;
  try {
    const raw = await readFile(dataPath("improvement-log.jsonl"), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    lastImprovement = JSON.parse(lines[lines.length - 1] ?? "null");
  } catch { /* no log yet */ }

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
