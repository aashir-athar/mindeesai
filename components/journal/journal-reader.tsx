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

  if (error) return <p className="text-danger text-sm">Error: {error}</p>;
  if (!entries) return <p className="text-bone-500 text-sm">Loading entries…</p>;
  if (entries.length === 0) {
    return (
      <p className="text-bone-500 text-sm max-w-xl leading-relaxed">
        No journal entries yet. Mindees writes one every ~22 hours during the
        scheduled cron tick. The first one lands a day or so after deploy.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-10 max-w-3xl">
      {entries.map((e) => {
        const d = new Date(e.ts);
        const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
        const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return (
          <article key={e.ts} className="border-l-2 border-bone-800 pl-6">
            <p className="text-eyebrow mb-3 text-bone-500">
              {dateStr} · {timeStr}
            </p>
            <p className="text-bone-100 text-lg leading-[1.65] font-light whitespace-pre-wrap">
              {e.entry}
            </p>
            <p className="text-bone-600 text-xs font-mono mt-4">
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
