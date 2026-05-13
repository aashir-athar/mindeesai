"use client";

/**
 * ThreadSwitcher — minimal dropdown listing recent auto-titled threads.
 *
 * Polls /api/threads on mount + every 30 s. Click any to navigate.
 * Lives in the chat top bar; replaces the static thread-id label.
 *
 * Auto-adaptive principle: user never names a thread, never archives a
 * thread, never pins a thread. They just chat. Their history is here.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";

type ThreadMeta = {
  id: string;
  title: string;
  createdAt: string;
  lastActivity: string;
  turns: number;
  preview?: string;
  lastUserMsg?: string;
};

export function ThreadSwitcher({ currentThreadId }: { currentThreadId: string }) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/threads?limit=20", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { threads?: ThreadMeta[] };
        if (alive && data.threads) setThreads(data.threads);
      } catch {/* ignore */}
    };
    load();
    const i = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = threads.find((t) => t.id === currentThreadId);
  const title = current?.title && current.title !== "Untitled thread"
    ? current.title
    : `thread ${currentThreadId.slice(0, 8)}`;

  return (
    <div ref={dropRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/[0.04] transition-colors text-sm text-bone-100"
      >
        <MessageSquare className="size-3.5 text-bone-400" />
        <span className="max-w-[18ch] truncate">{title}</span>
        <ChevronDown className={`size-3.5 text-bone-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[min(28rem,calc(100vw-2rem))] glass-strong rounded-2xl p-2 shadow-2xl z-40 max-h-[70vh] overflow-y-auto">
          <div className="px-3 pt-2 pb-3 flex items-center justify-between">
            <p className="text-eyebrow">RECENT THREADS</p>
            <Link
              href="/chat"
              onClick={() => setOpen(false)}
              className="text-eyebrow !text-warm-400 hover:!text-warm-300 transition-colors"
            >
              + NEW
            </Link>
          </div>
          {threads.length === 0 ? (
            <p className="px-3 py-4 text-sm text-bone-500">No prior threads yet.</p>
          ) : (
            <ul className="flex flex-col">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/chat/${t.id}`}
                    onClick={() => setOpen(false)}
                    className={`flex flex-col gap-1 px-3 py-3 rounded-xl hover:bg-white/[0.04] transition-colors ${
                      t.id === currentThreadId ? "bg-white/[0.025]" : ""
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-bone-50 text-sm font-medium truncate">
                        {t.title && t.title !== "Untitled thread" ? t.title : "Untitled"}
                      </span>
                      <span className="text-eyebrow !text-bone-500 shrink-0">
                        {relative(t.lastActivity)}
                      </span>
                    </div>
                    {(t.preview || t.lastUserMsg) && (
                      <p className="text-xs text-bone-400 line-clamp-1">
                        {t.lastUserMsg || t.preview}
                      </p>
                    )}
                    <p className="text-eyebrow !text-bone-500 text-tabular">
                      {t.turns} {t.turns === 1 ? "turn" : "turns"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function relative(iso: string): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86_400)}d`;
}
