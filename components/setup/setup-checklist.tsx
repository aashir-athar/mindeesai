"use client";

/**
 * SetupChecklist — render /api/health as a colour-coded health board.
 *
 * Each row is one subsystem; a single glance tells you what's wrong and
 * what to do about it. Polls every 10s so a fix you just applied
 * surfaces immediately.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

type HealthResponse = {
  ok: boolean;
  persistence: {
    mode: "local" | "vercel-blob" | "turso" | "external";
    blob_token_present: boolean;
    on_vercel: boolean;
  };
  memory: { ok: boolean; tables: string[] };
  cron: {
    configured: boolean;
    heartbeatCount?: number;
    lastHeartbeat?: { ts: string; event: string } | null;
    lastImprovement?: unknown;
    lastTrainingTick?: unknown;
  };
  self_learning_counts: {
    distill_rows: number;
    journal_entries: number;
    auto_research_runs: number;
    graph_triples: number;
    corrections: number;
    delights: number;
  };
  connectors: { count: number; names: string[] };
  features: Record<string, boolean>;
};

type Status = "ok" | "warn" | "bad" | "info";

function StatusDot({ s }: { s: Status }) {
  const cls =
    s === "ok" ? "bg-emerald-400" :
    s === "warn" ? "bg-amber-400" :
    s === "bad" ? "bg-rose-400" :
    "bg-bone-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} aria-hidden />;
}

function Row({ status, label, value, hint }: { status: Status; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="border border-bone-900 rounded p-4 flex gap-4 items-start">
      <div className="pt-1.5">
        <StatusDot s={status} />
      </div>
      <div className="flex-1">
        <p className="text-eyebrow mb-1">{label}</p>
        <p className="text-bone-100 text-sm font-mono">{value}</p>
        {hint && <p className="text-bone-400 text-xs mt-2 leading-relaxed">{hint}</p>}
      </div>
    </div>
  );
}

export function SetupChecklist() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const j = (await res.json()) as HealthResponse;
        if (alive) { setHealth(j); setError(null); }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (error) return <p className="text-rose-300 text-sm">Error reading /api/health: {error}</p>;
  if (!health) return <p className="text-bone-500 text-sm">Loading health…</p>;

  const counts = health.self_learning_counts;

  // ─── Status calculators ────────────────────────────────────────────────
  const persistenceStatus: Status =
    health.persistence.mode === "vercel-blob" && health.persistence.blob_token_present ? "ok" :
    health.persistence.on_vercel && !health.persistence.blob_token_present ? "bad" :
    "warn";

  const cronStatus: Status =
    (health.cron.heartbeatCount ?? 0) > 0 && health.cron.lastImprovement ? "ok" :
    (health.cron.heartbeatCount ?? 0) > 0 ? "warn" :
    "bad";

  const chatStatus: Status = counts.distill_rows > 0 ? "ok" : "warn";
  const graphStatus: Status = counts.graph_triples > 0 ? "ok" : "info";
  const journalStatus: Status = counts.journal_entries > 0 ? "ok" : "info";
  const researchStatus: Status = counts.auto_research_runs > 0 ? "ok" : "info";

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <Row
        status={persistenceStatus}
        label="PERSISTENCE"
        value={
          <>
            mode: <span className="text-bone-50">{health.persistence.mode}</span>
            {" · "}blob token: <span className={health.persistence.blob_token_present ? "text-emerald-400" : "text-rose-400"}>
              {health.persistence.blob_token_present ? "present" : "MISSING"}
            </span>
            {" · "}on vercel: {String(health.persistence.on_vercel)}
          </>
        }
        hint={
          persistenceStatus === "bad" ? (
            <>
              Critical: you&rsquo;re on Vercel but BLOB_READ_WRITE_TOKEN isn&rsquo;t set.
              Create a Blob store in your Vercel project, then redeploy.
              Without it, every chat turn writes to /tmp and vanishes.
            </>
          ) : persistenceStatus === "warn" ? (
            <>Persistence mode is &ldquo;{health.persistence.mode}&rdquo;. Fine for local dev. On Vercel, set MEMORY_PERSISTENCE=vercel-blob (or just provide BLOB_READ_WRITE_TOKEN — it auto-detects).</>
          ) : (
            <>State persists to Vercel Blob between function invocations. Audit pages can read what chat wrote.</>
          )
        }
      />

      <Row
        status={cronStatus}
        label="CRON (5-minute self-improvement loop)"
        value={
          <>
            configured: {String(health.cron.configured)}
            {" · "}heartbeats: <span className="text-bone-50">{health.cron.heartbeatCount ?? 0}</span>
            {" · "}successful ticks: <span className="text-bone-50">{health.cron.lastImprovement ? "≥1" : 0}</span>
          </>
        }
        hint={
          cronStatus === "bad" ? (
            <>
              Cron has NEVER reached this endpoint. Check your cron-job.org config:
              POST to https://YOUR-DOMAIN/api/cron/self-improve every 5 min
              with header <span className="font-mono">Authorization: Bearer CRON_SECRET</span>.
              Or hit <Link href="/admin" className="text-bone-100 underline">/admin</Link> → &ldquo;Run cron now&rdquo;.
            </>
          ) : cronStatus === "warn" ? (
            <>
              Cron IS firing ({health.cron.heartbeatCount} times) but no successful
              tick has completed yet. Likely cause: 60s function ceiling on Hobby.
              The latest budget-aware tick (Phase DD) should fix this — wait 5 minutes
              and re-check.
            </>
          ) : (
            <>Cron is firing successfully. journal / research / training-metrics
              will accumulate over time.</>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
        <CountTile status={chatStatus} label="Distill rows" value={counts.distill_rows} hint="Every chat turn = 1 row" />
        <CountTile status={graphStatus} label="Graph triples" value={counts.graph_triples} hint="Facts learned about you" />
        <CountTile status={journalStatus} label="Journal entries" value={counts.journal_entries} hint="Cron-gated, ~22h interval" />
        <CountTile status={researchStatus} label="Autonomous research" value={counts.auto_research_runs} hint="Topics Mindees studied on its own" />
        <CountTile status={counts.corrections > 0 ? "ok" : "info"} label="Corrections" value={counts.corrections} hint="Where you said &ldquo;no, it&rsquo;s X&rdquo;" />
        <CountTile status={counts.delights > 0 ? "ok" : "info"} label="Delights" value={counts.delights} hint="Moments that landed" />
      </div>

      <Row
        status={health.memory.ok ? "ok" : "bad"}
        label="VECTOR MEMORY (LanceDB)"
        value={
          <>tables: {health.memory.tables.length > 0 ? health.memory.tables.join(", ") : <span className="text-bone-500">none yet</span>}</>
        }
        hint="Tables are bootstrapped lazily — the first chat turn that calls rememberMany() creates them."
      />

      <Row
        status={health.connectors.count > 0 ? "ok" : "warn"}
        label="CONNECTORS (skills Mindees can use)"
        value={
          <>{health.connectors.count} loaded · {health.connectors.names.join(", ")}</>
        }
      />

      <Row
        status="info"
        label="FEATURE FLAGS"
        value={
          <>
            {Object.entries(health.features).map(([k, v]) => (
              <span key={k} className="inline-block mr-3">
                {k}: <span className={v ? "text-emerald-400" : "text-bone-500"}>{String(v)}</span>
              </span>
            ))}
          </>
        }
      />

      <div className="mt-6 flex gap-3 flex-wrap">
        <Link href="/admin" className="px-4 py-2 border border-bone-700 hover:border-bone-300 rounded text-bone-100 text-sm">→ /admin (controls + Run cron now)</Link>
        <Link href="/dashboard" className="px-4 py-2 border border-bone-700 hover:border-bone-300 rounded text-bone-100 text-sm">→ /dashboard (every tensor)</Link>
        <a href="/api/health" target="_blank" rel="noreferrer" className="px-4 py-2 border border-bone-700 hover:border-bone-300 rounded text-bone-100 text-sm">→ raw /api/health JSON</a>
      </div>
    </div>
  );
}

function CountTile({ status, label, value, hint }: { status: Status; label: string; value: number; hint: string }) {
  return (
    <div className="border border-bone-900 rounded p-3">
      <div className="flex items-center gap-2 mb-1">
        <StatusDot s={status} />
        <p className="text-eyebrow">{label}</p>
      </div>
      <p className="text-bone-100 text-2xl font-display">{value}</p>
      <p className="text-bone-500 text-[10px] mt-1">{hint}</p>
    </div>
  );
}
