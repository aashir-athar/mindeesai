"use client";

import type { Citation } from "@/lib/types";
import { useState } from "react";

/**
 * Hover-revealable citation pill.
 * Click → opens source. Hover → reveals title + snippet.
 */
export function CitationPill({ idx, citation }: { idx: number; citation: Citation }) {
  const [open, setOpen] = useState(false);
  const hostname = (() => {
    try { return new URL(citation.url).hostname.replace(/^www\./, ""); } catch { return citation.url; }
  })();
  return (
    <span className="relative inline-block">
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full glass text-[11px] hover:bg-white/[0.06] transition-colors max-w-[24ch] truncate"
      >
        <span className="font-mono text-aurora-400">[{idx}]</span>
        <span className="truncate">{hostname}</span>
      </a>
      {open && (
        <span className="absolute bottom-full left-0 mb-2 w-72 glass-strong rounded-xl p-3 z-50 text-xs">
          <p className="font-medium text-bone-100 mb-1 line-clamp-2">{citation.title}</p>
          {citation.snippet && <p className="text-bone-300 line-clamp-3 leading-relaxed">{citation.snippet}</p>}
        </span>
      )}
    </span>
  );
}
