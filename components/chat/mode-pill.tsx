"use client";

/**
 * Tiny indicator chip showing which brain is currently serving inference.
 *
 *   NATIVE   — Mindees' own transformer
 *   CLOUD    — bootstrap teacher (Groq, today)
 *   CLOUD ⚠  — checkpoint missing entirely; native isn't even an option yet
 *
 * Self-refreshes every 30 s — slower than mood/goal because the brain
 * swap is a global flag, not per-turn state.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

type InferenceMode = {
  mode: "native" | "cloud-bootstrap" | "cloud-no-checkpoint";
  label: string;
  variant: string;
};

export function ModePill() {
  const [info, setInfo] = useState<InferenceMode | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/inference-mode", { cache: "no-store" });
        const j = (await res.json()) as InferenceMode;
        if (alive) setInfo(j);
      } catch { /* ignore — pill just stays in its prior state */ }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!info) return null;

  const cls =
    info.mode === "native"
      ? "border-emerald-700/60 text-emerald-300 bg-emerald-950/30"
      : info.mode === "cloud-bootstrap"
        ? "border-sky-800/60 text-sky-300 bg-sky-950/20"
        : "border-amber-800/60 text-amber-300 bg-amber-950/20";

  const short =
    info.mode === "native"
      ? `NATIVE · ${info.variant}`
      : info.mode === "cloud-bootstrap"
        ? "CLOUD"
        : "CLOUD ⚠";

  return (
    <Link
      href="/admin"
      title={info.label}
      className={`hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border ${cls} hover:brightness-125 transition`}
    >
      {short}
    </Link>
  );
}
