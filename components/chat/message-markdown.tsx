"use client";

/**
 * Minimal markdown renderer.
 *
 * Why not pull in `react-markdown`? The model's output is constrained — we
 * really only need: paragraphs, code fences, inline code, bullet lists, and
 * `[N]` citation markers. A 90-line hand-rolled renderer wins on bundle size
 * and we control how citations render.
 *
 * For full GFM (tables, footnotes, etc.) swap this for `react-markdown` +
 * `remark-gfm` later — the call site doesn't change.
 */

import { useMemo } from "react";

export function MessageMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return (
            <pre key={i} className="my-4 overflow-x-auto rounded-xl bg-ink-800/80 border border-white/[0.06] p-4 font-mono text-[13px] leading-relaxed">
              {b.lang && <p className="text-bone-500 text-[10px] uppercase mb-2 tracking-wider">{b.lang}</p>}
              <code>{b.body}</code>
            </pre>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="my-3 list-disc pl-6 marker:text-aurora-400 text-bone-100 space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(it) }} />
              ))}
            </ul>
          );
        }
        return (
          <p
            key={i}
            className="my-3 text-bone-100 leading-relaxed text-[15px]"
            dangerouslySetInnerHTML={{ __html: renderInline(b.text) }}
          />
        );
      })}
    </>
  );
}

type Block =
  | { type: "p"; text: string }
  | { type: "code"; lang?: string; body: string }
  | { type: "ul"; items: string[] };

function parse(input: string): Block[] {
  const out: Block[] = [];
  const lines = input.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      i++;
      const start = i;
      while (i < lines.length && !lines[i]!.startsWith("```")) i++;
      out.push({ type: "code", lang, body: lines.slice(start, i).join("\n") });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (line.trim().length === 0) {
      i++;
      continue;
    }
    // Paragraph — gather until blank line
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim().length > 0 && !lines[i]!.startsWith("```") && !/^\s*[-*]\s+/.test(lines[i]!)) {
      buf.push(lines[i]!);
      i++;
    }
    out.push({ type: "p", text: buf.join(" ") });
  }
  return out;
}

function renderInline(text: string): string {
  let s = escapeHtml(text);
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code class="font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-white/[0.06] text-aurora-300">$1</code>');
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-bone-50 font-semibold">$1</strong>');
  // italic
  s = s.replace(/\*([^*]+)\*/g, '<em class="italic text-bone-200">$1</em>');
  // citation [N]
  s = s.replace(/\[(\d+)\]/g, '<sup class="text-aurora-400 font-mono text-[0.8em]">[<a href="#cite-$1">$1</a>]</sup>');
  // links
  s = s.replace(/\bhttps?:\/\/[^\s<]+/g, (m) => `<a href="${m}" target="_blank" rel="noreferrer" class="text-aurora-400 hover:underline">${shortenUrl(m)}</a>`);
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "") + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return u;
  }
}
