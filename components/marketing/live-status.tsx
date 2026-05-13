"use client";

/**
 * Live status pill — polls /api/health and shows the most recent training tick.
 *
 * The point is to *prove* the model is genuinely training. Visitors see a real
 * loss number that updates over time, not a marketing claim.
 */

import { useEffect, useState } from "react";

type Health = {
  cron: {
    configured: boolean;
    lastTrainingTick: { loss: number; tokens: number; ms: number; ranAt: string } | null;
    lastImprovement: { ranAt?: string } | null;
  };
  connectors: { count: number };
  memory: { ok: boolean; tables: string[] };
};

export function LiveStatus() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Health;
        if (mounted) setHealth(data);
      } catch { /* ignore */ }
    };
    tick();
    const i = setInterval(tick, 15_000);
    return () => { mounted = false; clearInterval(i); };
  }, []);

  const loss = health?.cron.lastTrainingTick?.loss;
  const tokens = health?.cron.lastTrainingTick?.tokens;
  const lastAt = health?.cron.lastTrainingTick?.ranAt ?? health?.cron.lastImprovement?.ranAt;

  return (
    <div className="glass rounded-2xl p-5 flex flex-wrap items-center gap-8 max-w-3xl">
      <Indicator label="Self-training" online={health?.cron.configured ?? false} />
      <Stat label="Last loss" value={loss !== undefined ? loss.toFixed(4) : "—"} />
      <Stat label="Tokens" value={tokens !== undefined ? formatCount(tokens) : "—"} />
      <Stat label="Connectors" value={health?.connectors.count ?? "—"} />
      <Stat label="Memory" value={health?.memory.ok ? "ready" : "—"} />
      <Stat label="Last tick" value={lastAt ? relative(lastAt) : "—"} />
    </div>
  );
}

function Indicator({ label, online }: { label: string; online: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`size-2 rounded-full ${online ? "bg-success pulse-dot" : "bg-bone-500"}`} />
      <span className="text-xs uppercase tracking-wider text-bone-300">{label}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-bone-500">{label}</span>
      <span className="text-sm font-mono text-bone-100">{value}</span>
    </div>
  );
}

function relative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, "") + "M";
}
