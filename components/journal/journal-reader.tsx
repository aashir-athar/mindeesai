"use client";

/**
 * JournalReader — chronological reader for Mindees' own journal entries.
 * Hits /api/journal on mount and renders each entry as a small editorial
 * card with its date, dominant mood at writing, and the top topics that
 * shaped that day.
 */

import { useEffect, useState } from "react";

type Entry = {
  ts: string;
  entry: string;
  mood_at_writing: Record<string, number>;
  top_topics: string[];
  reflection_count: number;
};

function topMoodDims(mood: Record<string, number>, n = 2): string[] {
  return Object.entries(mood)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n)
    .map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`);
}

export function JournalReader() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/journal?limit=50", { cache: "no-store" });
        const j = (await res.json()) as { ok: boolean; entries: Entry[] };
        if (alive) setEntries(j.entries);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <p className="text-rose-300 text-sm">Error: {error}</p>;
  if (!entries) return <p className="text-bone-500 text-sm">Loading entries…</p>;
  if (entries.length === 0) {
    return (
      <p className="text-bone-500 text-[15px] leading-relaxed max-w-xl">
        No journal entries yet. MindeesAI writes one every ~22 hours during the scheduled cron tick. The first one lands within a few hours of the first chat.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-14">
      {entries.map((e) => {
        const d = new Date(e.ts);
        const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
        const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return (
          <article key={e.ts}>
            <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em] mb-3">
              {dateStr} · {timeStr}
            </p>
            <p className="text-bone-100 text-[17px] leading-[1.7] font-light whitespace-pre-wrap">
              {e.entry}
            </p>
            <p className="text-bone-600 text-[11px] font-mono mt-5">
              {topMoodDims(e.mood_at_writing).join(" · ")}
              {e.top_topics.length > 0 && (
                <> · topics: {e.top_topics.slice(0, 5).join(", ")}</>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}
