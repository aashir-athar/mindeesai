"use client";

/**
 * ChatCanvas — vertical chat surface, Claude / Grok aesthetic.
 *
 * Layout:
 *   - Slim sticky header (brand · thread switcher · mood/mode pills)
 *   - Centered max-w-3xl message column (vertical scroll)
 *   - Bottom-pinned composer (auto-grow textarea, model chips, send)
 *
 * Visual language:
 *   - User messages: right-aligned, subtle rounded "card" — feels like
 *     paper, not a chat bubble.
 *   - Assistant messages: full-width, no card, just typography with a
 *     small brand mark in the gutter. This is the Claude move — it
 *     prevents the long-form replies from feeling cramped.
 *
 * State machine + SSE handling are identical to the prior horizontal
 * canvas version; only the JSX changed.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Send, ArrowLeft, ThumbsUp, ThumbsDown, BookText, Wrench, Plus, Square } from "lucide-react";
import type { Citation } from "@/lib/types";
import { trust } from "@/lib/psychology/trust";
import { nid } from "@/lib/utils";
import { CitationPill } from "./citation-pill";
import { MessageMarkdown } from "./message-markdown";
import { ThreadSwitcher } from "./thread-switcher";
import { ModePill } from "./mode-pill";
import { ResearchStatus } from "./research-status";
import { Monogram } from "@/components/marketing/monogram";

type RecalledMemory = { text: string; score: number; source?: string };

type Exchange = {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  toolActivity: Array<{ name: string; ok: boolean; ms: number }>;
  recalled?: RecalledMemory[];
  reasoning?: string;
  stage?: string;
};

type MoodSnapshot = {
  values: Record<string, number>;
  steps: number;
  lastRegister?: string;
};
type GoalSnapshot = { goal: string; confidence: number } | null;

export function ChatCanvas({ threadId }: { threadId: string }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [mood, setMood] = useState<MoodSnapshot | null>(null);
  const [goal, setGoal] = useState<GoalSnapshot>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // On mount: pull existing thread messages from the server and pair them
  // into Exchange shapes. Refreshing the browser used to drop the visible
  // history even though the server still had the transcript on disk and
  // in Blob. This restores the rendered conversation on every load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, { cache: "no-store" });
        if (!res.ok) { if (alive) setHydrated(true); return; }
        const data = (await res.json()) as {
          messages?: Array<{ id: string; role: string; content: string; citations?: Citation[]; createdAt?: string }>;
        };
        if (!alive) return;
        const restored = messagesToExchanges(data.messages ?? []);
        setExchanges(restored);
        setHydrated(true);
        // Scroll to bottom of restored history after the next paint
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        });
      } catch {
        if (alive) setHydrated(true);
      }
    })();
    return () => { alive = false; };
  }, [threadId]);

  // Mood + goal polling — same logic as before, every 30s + on exchange complete.
  useEffect(() => {
    const load = () => {
      fetch(`/api/persona?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { mood?: MoodSnapshot; goal?: { goal: string; confidence: number } } | null) => {
          if (data?.mood) setMood(data.mood);
          if (
            data?.goal && data.goal.goal &&
            data.goal.goal !== "unset — first turn" &&
            data.goal.goal !== "exploring — not yet clear"
          ) {
            setGoal({ goal: data.goal.goal, confidence: data.goal.confidence });
          }
        })
        .catch(() => undefined);
    };
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, [threadId, exchanges.length]);

  // Auto-scroll to bottom on new message or streamed text — only when the
  // user is already near the bottom (so they aren't yanked away from
  // re-reading an earlier message).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 240) {
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    }
  }, [exchanges]);

  // Auto-grow textarea — Claude/Grok feel
  useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 240)}px`;
  }, [input]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const ex: Exchange = {
      id: nid(),
      question: text,
      answer: "",
      citations: [],
      toolActivity: [],
      stage: "thinking",
    };
    setExchanges((prev) => [...prev, ex]);
    setInput("");
    setStreaming(true);
    setStage("thinking");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`server ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const eventBlock of events) handleSSE(eventBlock, ex.id);
      }
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setExchanges((prev) =>
          prev.map((x) =>
            x.id === ex.id
              ? { ...x, answer: (x.answer || "") + `\n\n_Error: ${(err as Error).message}_`, stage: undefined }
              : x,
          ),
        );
      }
    } finally {
      setStreaming(false);
      setStage("");
      abortRef.current = null;
    }
  }

  function handleSSE(block: string, exId: string) {
    const evLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!evLine || !dataLine) return;
    const event = evLine.slice(6).trim();
    let data: { stage?: string; text?: string; citation?: Citation; name?: string; ok?: boolean; ms?: number; error?: string };
    try {
      data = JSON.parse(dataLine.slice(5).trim());
    } catch {
      return;
    }
    setExchanges((prev) =>
      prev.map((x) => {
        if (x.id !== exId) return x;
        switch (event) {
          case "stage":
            setStage(data.stage ?? "");
            return { ...x, stage: data.stage };
          case "mood":
            if ((data as { mood?: MoodSnapshot }).mood) setMood((data as { mood: MoodSnapshot }).mood);
            return x;
          case "memories":
            return { ...x, recalled: (data as unknown as { recalled: RecalledMemory[] }).recalled };
          case "replace-answer":
            return { ...x, answer: (data as unknown as { text: string }).text ?? "" };
          case "reasoning":
            return { ...x, reasoning: (x.reasoning ?? "") + (data.text ?? "") };
          case "text":
            return { ...x, answer: (x.answer || "") + (data.text ?? "") };
          case "tool-start":
            setStage(`tool:${data.name}`);
            return x;
          case "tool-end":
            return {
              ...x,
              toolActivity: [
                ...x.toolActivity,
                { name: data.name ?? "tool", ok: !!data.ok, ms: data.ms ?? 0 },
              ],
            };
          case "citation":
            return data.citation ? { ...x, citations: [...x.citations, data.citation] } : x;
          case "finish":
            return { ...x, stage: undefined };
          case "error":
            return { ...x, answer: x.answer + `\n_Error: ${data.error}_`, stage: undefined };
          default:
            return x;
        }
      }),
    );
  }

  return (
    <main className="relative h-dvh flex flex-col bg-ink-950">
      {/* ─── Slim sticky header ──────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-3 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            aria-label="Home"
            className="size-8 inline-flex items-center justify-center rounded-lg hover:bg-white/[0.05] transition-colors text-bone-400 hover:text-bone-100"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <Link href="/" aria-label="MindeesAI" className="inline-flex items-center gap-2">
            <Monogram size={22} />
            <span className="text-sm font-medium text-bone-100 tracking-tight hidden sm:inline">MindeesAI</span>
          </Link>
          <span className="h-5 w-px bg-white/[0.08] hidden sm:inline-block" aria-hidden />
          <div className="min-w-0">
            <ThreadSwitcher currentThreadId={threadId} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ResearchStatus />
          {goal && <GoalRibbon goal={goal} />}
          {mood && <MoodPill mood={mood} />}
          <ModePill />
          <Link
            href="/dashboard"
            className="text-xs text-bone-400 hover:text-bone-100 transition-colors hidden md:inline px-2 py-1"
          >
            Dashboard
          </Link>
        </div>
      </header>

      {/* ─── Vertical message column ─────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          {!hydrated ? (
            // While we're fetching the existing thread, show nothing — don't
            // flash the empty state and then suddenly fill in old messages.
            <div className="h-0" aria-hidden />
          ) : exchanges.length === 0 ? (
            <EmptyState onSelect={(s) => setInput(s)} />
          ) : (
            <div className="flex flex-col gap-12">
              {exchanges.map((ex) => (
                <Exchange key={ex.id} exchange={ex} threadId={threadId} />
              ))}
            </div>
          )}
          {/* Bottom spacer so the last message clears the composer */}
          <div className="h-32" aria-hidden />
        </div>
      </div>

      {/* ─── Bottom-pinned composer ──────────────────────────────────── */}
      <div className="sticky bottom-0 z-20 border-t border-white/[0.06] bg-gradient-to-t from-ink-950 via-ink-950/95 to-ink-950/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <form
            onSubmit={send}
            className="relative rounded-2xl border border-white/[0.08] bg-ink-900/60 focus-within:border-white/[0.18] transition-colors"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(e as unknown as FormEvent);
                }
              }}
              rows={1}
              placeholder={streaming ? trust.thinking : "Ask anything…"}
              className="w-full resize-none bg-transparent outline-none text-bone-50 placeholder:text-bone-500 px-4 pt-4 pb-12 text-[15px] leading-relaxed"
              style={{ maxHeight: "240px" }}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 pb-3 pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto">
                {streaming && <StagePill stage={stage} />}
              </div>
              <div className="pointer-events-auto">
                {streaming ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="Stop"
                    className="size-9 inline-flex items-center justify-center rounded-lg bg-bone-50 text-ink-950 hover:bg-white transition-colors"
                  >
                    <Square className="size-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send"
                    className="size-9 inline-flex items-center justify-center rounded-lg bg-bone-50 text-ink-950 hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Send className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </form>
          <p className="text-[11px] text-bone-600 text-center mt-2 font-mono">
            ⏎ to send · shift+⏎ for newline · MindeesAI can be wrong; verify what matters.
          </p>
        </div>
      </div>
    </main>
  );
}

// ─── One full exchange (user msg + assistant reply) ────────────────────────

function Exchange({ exchange, threadId }: { exchange: Exchange; threadId: string }) {
  return (
    <div className="flex flex-col gap-6">
      {/* User message — right-aligned, soft card */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-bone-50/[0.04] border border-white/[0.05] px-4 py-3 text-bone-100 text-[15px] leading-relaxed whitespace-pre-wrap">
          {exchange.question}
        </div>
      </div>

      {/* Assistant reply — full width, no bubble */}
      <div className="flex gap-3">
        <div className="shrink-0 pt-1">
          <Monogram size={26} />
        </div>
        <div className="flex-1 min-w-0">
          {exchange.recalled && exchange.recalled.length > 0 && (
            <MemoryRecallStrip recalled={exchange.recalled} />
          )}

          {exchange.reasoning && <ReasoningDisclosure text={exchange.reasoning} />}

          <div className="prose prose-invert prose-sm sm:prose-base max-w-none">
            {exchange.answer ? (
              <MessageMarkdown text={exchange.answer} />
            ) : (
              <ThinkingShimmer stage={exchange.stage} />
            )}
          </div>

          {exchange.toolActivity.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {exchange.toolActivity.map((t, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    t.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-rose-900/30 text-rose-300"
                  }`}
                >
                  <Wrench className="size-3" />
                  {t.name} · {Math.round(t.ms)}ms
                </span>
              ))}
            </div>
          )}

          {exchange.citations.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/[0.05]">
              <div className="flex items-center gap-2 mb-2">
                <BookText className="size-3 text-bone-500" />
                <p className="text-eyebrow">{trust.cite(exchange.citations.length)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {exchange.citations.map((c, i) => (
                  <CitationPill key={`${c.url}-${i}`} idx={i + 1} citation={c} />
                ))}
              </div>
            </div>
          )}

          {exchange.answer && !exchange.stage && (
            <div className="mt-3">
              <ThumbActions threadId={threadId} messageId={exchange.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState({ onSelect }: { onSelect: (s: string) => void }) {
  const prompts = [
    "What can you actually do?",
    "Search the web for the latest Next.js 16 release notes",
    "Explain how your self-improvement loop works",
    "What do you remember about me?",
  ];
  return (
    <div className="flex flex-col items-center text-center gap-8 pt-8 sm:pt-16">
      <Monogram size={72} />
      <div className="flex flex-col gap-3">
        <h1 className="text-display text-3xl sm:text-5xl leading-[1.1] text-bone-50">
          What's on your <em className="not-italic aurora-grad">mind</em>?
        </h1>
        <p className="text-bone-400 text-base sm:text-lg max-w-md mx-auto leading-relaxed">
          MindeesAI remembers every conversation and trains on it. The next thing you ask makes the next answer measurably better.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl mt-4">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            className="text-left text-sm text-bone-300 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10] px-4 py-3 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Pair messages from the server (user / assistant / tool, in order)
 * into the Exchange shape the chat-canvas renders. Each user message
 * starts a new exchange; the following assistant message fills its
 * answer. Tool messages are ignored on restore (their citations already
 * flow with the assistant message that consumed them).
 */
function messagesToExchanges(
  msgs: Array<{ id: string; role: string; content: string; citations?: Citation[]; createdAt?: string }>,
): Exchange[] {
  const out: Exchange[] = [];
  let pending: Exchange | null = null;
  for (const m of msgs) {
    if (m.role === "user") {
      if (pending) out.push(pending);
      pending = {
        id: m.id,
        question: m.content,
        answer: "",
        citations: [],
        toolActivity: [],
      };
    } else if (m.role === "assistant" && pending) {
      pending.answer = m.content;
      pending.citations = m.citations ?? [];
      out.push(pending);
      pending = null;
    }
    // tool messages are skipped on restore
  }
  if (pending) out.push(pending);
  return out;
}

// ─── Auxiliary components ─────────────────────────────────────────────────

function StagePill({ stage }: { stage: string }) {
  let label: string = "Working…";
  if (stage === "context") label = trust.retrieving;
  else if (stage === "reasoning") label = "Reasoning…";
  else if (stage === "thinking") label = trust.thinking;
  else if (stage.startsWith("tool:")) label = trust.toolPending(stage.slice(5));
  else if (stage === "synthesising") label = trust.draftingFinal;
  return (
    <span className="inline-flex items-center gap-2 text-[10px] text-bone-400 font-mono">
      <span className="size-1.5 rounded-full bg-aurora-400 pulse-dot" />
      {label}
    </span>
  );
}

function MemoryRecallStrip({ recalled }: { recalled: RecalledMemory[] }) {
  return (
    <details className="group mb-3 rounded-lg border border-white/[0.06] bg-warm-400/[0.03] px-3 py-2">
      <summary className="cursor-pointer select-none text-eyebrow inline-flex items-center gap-2 hover:text-warm-400 transition-colors">
        <span className="size-1.5 rounded-full bg-warm-400" />
        Remembered {recalled.length} thing{recalled.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5 text-[12px] text-bone-300 leading-relaxed">
        {recalled.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-warm-400 text-tabular text-[10px] mt-1 shrink-0">{(r.score * 100).toFixed(0)}%</span>
            <span className="flex-1">
              <span className="line-clamp-2">{r.text}</span>
              <span className="text-eyebrow !text-bone-600 ml-2">— {r.source}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GoalRibbon({ goal }: { goal: { goal: string; confidence: number } }) {
  return (
    <span
      className="hidden xl:inline-flex items-center gap-2 max-w-[28ch] truncate text-[11px] text-bone-400"
      title={`Goal confidence: ${(goal.confidence * 100).toFixed(0)}%`}
    >
      <span className="text-eyebrow !text-bone-600">GOAL</span>
      <span className="text-bone-200 italic truncate">{goal.goal}</span>
    </span>
  );
}

function MoodPill({ mood }: { mood: MoodSnapshot }) {
  const entries = Object.entries(mood.values).filter(([k]) => k !== "calm");
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 2).filter(([, v]) => v > 0.35);
  const labels: Record<string, string> = {
    curiosity: "curious",
    warmth: "warm",
    playfulness: "playful",
    focus: "focused",
    wonder: "thoughtful",
    frustration: "tense",
    confidence: "settled",
  };
  const summary = top.length > 0 ? top.map(([k]) => labels[k] ?? k).join(" + ") : "settled";
  return (
    <Link
      href="/dashboard"
      title="MindeesAI's current 8-dimension mood — click for full dashboard"
      className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/[0.06] bg-white/[0.02] text-[11px] text-bone-300 hover:bg-white/[0.04] transition-colors"
    >
      <span className="size-1.5 rounded-full bg-warm-400 pulse-dot" aria-hidden />
      <span className="text-bone-100">{summary}</span>
      <span className="text-bone-600 font-mono text-[9px]">·{mood.steps}</span>
    </Link>
  );
}

function ReasoningDisclosure({ text }: { text: string }) {
  return (
    <details className="group mb-3">
      <summary className="cursor-pointer text-eyebrow inline-flex items-center gap-2 select-none hover:text-aurora-400 transition-colors">
        <span className="size-1.5 rounded-full bg-aurora-400" />
        Reasoning · {text.length} chars
      </summary>
      <div className="mt-2 rounded-lg border border-white/[0.06] bg-ink-800/40 p-3 text-[12px] leading-relaxed text-bone-300 font-mono whitespace-pre-wrap">
        {text}
      </div>
    </details>
  );
}

function ThinkingShimmer({ stage }: { stage?: string }) {
  let label: string = trust.thinking;
  if (stage === "context") label = "Loading memory…";
  else if (stage === "reasoning") label = "Reasoning step-by-step…";
  else if (stage?.startsWith("tool:")) label = trust.toolPending(stage.slice(5));
  else if (!stage || stage === "synthesising") label = trust.draftingFinal;
  return (
    <div className="flex items-center gap-2 text-bone-500 text-sm py-1">
      <span className="size-2 rounded-full bg-aurora-400 pulse-dot" />
      <span>{label}</span>
    </div>
  );
}

function ThumbActions({ threadId, messageId }: { threadId: string; messageId: string }) {
  const [signal, setSignal] = useState<"up" | "down" | null>(null);
  async function send(s: "up" | "down") {
    setSignal(s);
    fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, messageId, signal: s }),
    }).catch(() => undefined);
  }
  return (
    <div className="flex gap-0.5">
      <button
        aria-label="Thumb up"
        onClick={() => send("up")}
        className={`p-1.5 rounded-md hover:bg-white/[0.06] transition-colors ${
          signal === "up" ? "text-emerald-400" : "text-bone-500 hover:text-bone-300"
        }`}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        aria-label="Thumb down"
        onClick={() => send("down")}
        className={`p-1.5 rounded-md hover:bg-white/[0.06] transition-colors ${
          signal === "down" ? "text-rose-400" : "text-bone-500 hover:text-bone-300"
        }`}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </div>
  );
}

// Plus icon imported but unused at the moment; keep for future "new thread"
// shortcut in the composer area.
void Plus;
