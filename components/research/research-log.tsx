"use client";

/**
 * ResearchLog — chronological table of autonomous-research events.
 */

import { useEffect, useState } from "react";

type Entry = {
  ts: string;
  topic: string;
  reason: "correction" | "user-didnt-know" | "user-uncertain";
  hits: number;
  passages: number;
  ok: boolean;
};

const REASON_LABEL: Record<Entry["reason"], string> = {
  "correction": "You corrected me",
  "user-didnt-know": "You didn't know it yet",
  "user-uncertain": "You weren't sure",
};

const REASON_COLOUR: Record<Entry["reason"], string> = {
  "correction":      "text-rose-400/80",
  "user-didnt-know": "text-amber-400/80",
  "user-uncertain":  "text-sky-400/80",
};

export function ResearchLog() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/research-log?limit=100", { cache: "no-store" });
        const j = (await res.json()) as { ok: boolean; entries: Entry[] };
        if (alive) setEntries(j.entries);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <p className="text-danger text-sm">Error: {error}</p>;
  if (!entries) return <p className="text-bone-500 text-sm">Loading log…</p>;
  if (entries.length === 0) {
    return (
      <p className="text-bone-500 text-[15px] leading-relaxed max-w-xl">
        No autonomous research yet. The cron tick fires every five minutes; the first batch lands once there&rsquo;s enough chat history to extract uncertainty signals from.
      </p>
    );
  }

  // Summary stats
  const totalPassages = entries.reduce((s, e) => s + e.passages, 0);
  const okCount = entries.filter((e) => e.ok).length;

  return (
    <div className="flex flex-col gap-12">
      <div className="grid grid-cols-3 gap-8 sm:gap-12 max-w-xl">
        <Stat label="Topics studied" value={entries.length.toString()} />
        <Stat label="Passages learned" value={totalPassages.toString()} />
        <Stat label="Success rate" value={`${Math.round((okCount / entries.length) * 100)}%`} />
      </div>

      <div className="flex flex-col divide-y divide-white/[0.06]">
        {entries.map((e, i) => {
          const d = new Date(e.ts);
          const when = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <div key={i} className="py-3.5 grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_auto] gap-3 sm:gap-5 items-center">
              <span className="text-bone-600 font-mono text-[11px] whitespace-nowrap tabular-nums">{when}</span>
              <span className="text-bone-100 text-[14px] truncate">{e.topic}</span>
              <span className={`hidden sm:inline text-[10px] font-mono uppercase tracking-wider ${REASON_COLOUR[e.reason]}`}>
                {REASON_LABEL[e.reason]}
              </span>
              <span className="text-bone-500 font-mono text-[11px] whitespace-nowrap tabular-nums">
                {e.ok ? `${e.passages}p` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em] mb-2">{label}</p>
      <p className="text-bone-50 text-[28px] font-display tabular-nums leading-none">{value}</p>
    </div>
  );
}
