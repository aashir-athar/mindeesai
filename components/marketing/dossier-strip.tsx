"use client";

/**
 * DossierStrip — live data ticker styled as an editorial dossier.
 *
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │  LIVE TRAINING       LAST LOSS        TOKENS         CONNECTORS       … │
 *   │  ●                   2.4137           18,492         6                  │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * Polls /api/health every 15 s. Tabular numerals everywhere. No motion noise.
 */

import { useEffect, useState } from "react";

type Health = {
  cron: {
    configured: boolean;
    lastTrainingTick: { loss: number; tokens: number; ms: number; ranAt: string } | null;
    lastImprovement: { ranAt?: string } | null;
  };
  connectors: { count: number };
  memory: { ok: boolean };
};

export function DossierStrip() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Health;
        if (alive) setHealth(data);
      } catch {/* ignore */}
    };
    tick();
    const i = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  const last = health?.cron.lastTrainingTick;
  const loss = last?.loss;
  const tokens = last?.tokens;
  const lastAt = last?.ranAt ?? health?.cron.lastImprovement?.ranAt;

  return (
    <div className="glass rounded-2xl px-6 py-5 flex flex-wrap items-baseline gap-x-10 gap-y-4">
      <Cell
        label="LIVE TRAINING"
        value={
          <span className="inline-flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${health?.cron.configured ? "bg-success pulse-dot" : "bg-bone-500"}`} />
            <span>{health?.cron.configured ? "Active" : "Standby"}</span>
          </span>
        }
      />
      <Cell label="LAST LOSS"  value={fmt(loss, (n) => n.toFixed(4))} />
      <Cell label="TOKENS"     value={fmt(tokens, formatCount)} />
      <Cell label="CONNECTORS" value={fmt(health?.connectors.count, String)} />
      <Cell label="MEMORY"     value={health?.memory.ok ? "Online" : "—"} />
      <Cell label="LAST TICK"  value={lastAt ? relative(lastAt) : "—"} />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-eyebrow">{label}</span>
      <span className="text-tabular text-base text-bone-50">{value}</span>
    </div>
  );
}

function fmt<T>(v: T | undefined | null, render: (v: T) => string): string {
  return v === undefined || v === null ? "—" : render(v);
}

function relative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, "") + "M";
}
