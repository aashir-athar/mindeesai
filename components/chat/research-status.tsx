"use client";

/**
 * ResearchStatus — soft "Mindees is thinking about X right now" indicator
 * in the chat header. Renders nothing when no research is in flight; a
 * subtle pulsing chip when there is. Polls every 4 s.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

type Beacon = {
  topic: string;
  startedAt: string;
  reason?: string;
};

export function ResearchStatus() {
  const [beacon, setBeacon] = useState<Beacon | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/research-now", { cache: "no-store" });
        const j = (await res.json()) as { researching: Beacon | null };
        if (alive) setBeacon(j.researching);
      } catch { /* keep prior state */ }
    };
    tick();
    const id = setInterval(tick, 4_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!beacon) return null;

  return (
    <Link
      href="/research"
      title={`Reason: ${beacon.reason ?? "research"} — started ${new Date(beacon.startedAt).toLocaleTimeString()}`}
      className="hidden lg:inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border border-warm-700/50 bg-warm-950/30 text-warm-300 hover:text-warm-100 transition group"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warm-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-warm-300" />
      </span>
      <span className="max-w-[18ch] truncate group-hover:max-w-[36ch] transition-[max-width] duration-500">
        thinking about <span className="text-warm-100">{beacon.topic}</span>
      </span>
    </Link>
  );
}
