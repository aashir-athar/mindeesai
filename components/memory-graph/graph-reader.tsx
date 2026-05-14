"use client";

/**
 * GraphReader — searchable, predicate-faceted view of the triple store.
 *
 * Hits /api/memory-graph once on mount, renders:
 *   - filter input (matches across subject/predicate/object)
 *   - top predicates as toggleable chips
 *   - the matching triple stream as editorial rows
 */

import { useEffect, useMemo, useState } from "react";

type Triple = {
  subject: string;
  predicate: string;
  object: string;
  source?: string;
  createdAt: string;
};

type GraphResponse = {
  ok: boolean;
  count: number;
  triples: Triple[];
  byPredicate: Record<string, number>;
  bySubject: Record<string, number>;
};

export function GraphReader() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [predicate, setPredicate] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/memory-graph", { cache: "no-store" });
        const j = (await res.json()) as GraphResponse;
        if (alive) setData(j);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.triples.filter((t) => {
      if (predicate && t.predicate !== predicate) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        t.predicate.toLowerCase().includes(q) ||
        t.object.toLowerCase().includes(q)
      );
    });
  }, [data, query, predicate]);

  if (error) return <p className="text-danger text-sm">Error: {error}</p>;
  if (!data) return <p className="text-bone-500 text-sm">Loading triples…</p>;
  if (data.count === 0) {
    return (
      <p className="text-bone-500 text-sm max-w-xl leading-relaxed">
        No triples in the store yet. They accumulate from chat — Mindees runs
        a small extractor on each turn and writes anything that looks like a
        durable fact about the user, their preferences, their projects, etc.
      </p>
    );
  }

  const topPredicates = Object.entries(data.byPredicate)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <input
          type="text"
          placeholder="Search subject, predicate, or object…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent border-b border-white/[0.10] focus:border-warm-400/60 px-1 py-2 text-bone-100 text-[14px] outline-none transition-colors"
        />
        <p className="text-bone-500 text-[11px] font-mono whitespace-nowrap tabular-nums">
          {filtered.length} / {data.count} triples
        </p>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2 text-[12px]">
        <button
          onClick={() => setPredicate(null)}
          className={`cursor-pointer font-mono lowercase tracking-wider transition-colors duration-200 ${
            predicate === null ? "text-bone-50" : "text-bone-500 hover:text-bone-200"
          }`}
        >
          all
        </button>
        {topPredicates.map(([p, n]) => (
          <button
            key={p}
            onClick={() => setPredicate(p === predicate ? null : p)}
            className={`cursor-pointer font-mono lowercase tracking-wider transition-colors duration-200 ${
              predicate === p ? "text-bone-50" : "text-bone-500 hover:text-bone-200"
            }`}
          >
            {p.replace(/_/g, " ")}<span className="text-bone-700"> {n}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col divide-y divide-white/[0.06]">
        {filtered.slice(0, 200).map((t, i) => (
          <div key={i} className="py-3 grid grid-cols-[1fr_auto_1fr] sm:grid-cols-[1fr_auto_1fr_auto] gap-3 sm:gap-5 items-center text-[14px]">
            <span className="text-bone-100 truncate">{t.subject}</span>
            <span className="text-bone-500 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">
              {t.predicate.replace(/_/g, " ")}
            </span>
            <span className="text-bone-300 truncate">{t.object}</span>
            <span className="hidden sm:inline text-bone-700 font-mono text-[10px] whitespace-nowrap tabular-nums">
              {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}
            </span>
          </div>
        ))}
        {filtered.length > 200 && (
          <p className="text-bone-600 text-[11px] font-mono pt-3">
            Showing first 200 of {filtered.length}. Refine the search to narrow.
          </p>
        )}
      </div>
    </div>
  );
}
