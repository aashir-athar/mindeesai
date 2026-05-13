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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    siteUrl: env.SITE_URL,
    memory: lance,
    connectors: {
      count: reg.size,
      names: [...reg.keys()],
    },
    cron: {
      configured: !!env.CRON_SECRET,
      lastImprovement,
      lastTrainingTick,
    },
    features: {
      research: env.ENABLE_WEB_RESEARCH,
      reflection: env.ENABLE_SELF_REFLECTION,
      sandbox: env.ENABLE_CONNECTOR_SANDBOX,
      vision: env.ENABLE_VISION,
    },
  });
}
