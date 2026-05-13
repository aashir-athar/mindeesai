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
  "correction": "text-rose-300 border-rose-900/60 bg-rose-950/20",
  "user-didnt-know": "text-amber-300 border-amber-900/60 bg-amber-950/20",
  "user-uncertain": "text-sky-300 border-sky-900/60 bg-sky-950/20",
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
      <p className="text-bone-500 text-sm max-w-xl leading-relaxed">
        No autonomous research yet. The cron tick fires every five minutes; the
        first batch lands shortly after deploy, once there&rsquo;s enough chat
        history to extract uncertainty signals from.
      </p>
    );
  }

  // Summary stats
  const totalPassages = entries.reduce((s, e) => s + e.passages, 0);
  const okCount = entries.filter((e) => e.ok).length;

  return (
    <div className="flex flex-col gap-8 max-w-4xl">
      <div className="grid grid-cols-3 gap-4 max-w-2xl">
        <Stat label="Topics studied" value={entries.length.toString()} />
        <Stat label="Passages learned" value={totalPassages.toString()} />
        <Stat label="Success rate" value={`${Math.round((okCount / entries.length) * 100)}%`} />
      </div>

      <div className="flex flex-col divide-y divide-bone-900">
        {entries.map((e, i) => {
          const d = new Date(e.ts);
          const when = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <div key={i} className="py-4 grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center">
              <span className="text-bone-600 font-mono text-xs whitespace-nowrap">{when}</span>
              <span className="text-bone-100 truncate">{e.topic}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border ${REASON_COLOUR[e.reason]}`}>
                {REASON_LABEL[e.reason]}
              </span>
              <span className="text-bone-500 font-mono text-xs whitespace-nowrap">
                {e.ok ? `${e.passages} passage${e.passages === 1 ? "" : "s"}` : "no results"}
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
    <div className="border border-bone-800 rounded p-4">
      <p className="text-eyebrow mb-1">{label}</p>
      <p className="text-bone-100 text-2xl font-display">{value}</p>
    </div>
  );
}
