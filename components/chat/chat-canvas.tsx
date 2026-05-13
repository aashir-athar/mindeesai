"use client";

/**
 * ChatCanvas — horizontal "thinking canvas" of exchanges.
 *
 * Design (v2 — fixed):
 *   - Each card = ONE complete exchange (user question + assistant answer)
 *     instead of separating them into two narrow cards.
 *   - Cards are `shrink-0` with a fixed `min-w-[42rem]` so they actually
 *     overflow horizontally instead of squishing.
 *   - Cards are top-aligned (`items-start`) — no full-viewport-height stretch.
 *   - Composer is its own visible card at the right edge, not a stretched
 *     bar at the bottom. Stage indicator lives inside the composer card.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Send, ArrowLeft, ThumbsUp, ThumbsDown, BookText, Wrench, Sparkles } from "lucide-react";
import type { Citation } from "@/lib/types";
import { trust } from "@/lib/psychology/trust";
import { nid } from "@/lib/utils";
import { CitationPill } from "./citation-pill";
import { MessageMarkdown } from "./message-markdown";

type Exchange = {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  toolActivity: Array<{ name: string; ok: boolean; ms: number }>;
  reasoning?: string;
  stage?: string;
};

export function ChatCanvas({ threadId }: { threadId: string }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the rightmost card when a new exchange begins or finishes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollTo({ left: el.scrollWidth, behavior: "smooth" }));
  }, [exchanges.length]);

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
    <main className="relative min-h-dvh flex flex-col">
      <header className="fixed top-0 inset-x-0 z-30 px-6 py-4 flex items-center justify-between border-b border-white/[0.06] glass">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-bone-300 hover:text-bone-100 transition-colors inline-flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-4" />
            Home
          </Link>
          <span className="text-bone-500 text-xs font-mono">thread {threadId.slice(0, 8)}</span>
        </div>
        <Link href="/chat" className="text-sm text-bone-300 hover:text-bone-100 transition-colors">
          + new thread
        </Link>
      </header>

      <div
        ref={canvasRef}
        className="horizontal-scroll flex-1 pt-24 pb-12 items-start"
      >
        {exchanges.length === 0 ? (
          <EmptyState />
        ) : (
          exchanges.map((ex) => <ExchangeCard key={ex.id} exchange={ex} threadId={threadId} />)
        )}

        <ComposerCard
          input={input}
          setInput={setInput}
          streaming={streaming}
          stage={stage}
          onSubmit={send}
          onAbort={() => abortRef.current?.abort()}
        />

        <div className="shrink-0 w-8" aria-hidden />
      </div>
    </main>
  );
}

// ─── Exchange card ─────────────────────────────────────────────────────────

function ExchangeCard({ exchange, threadId }: { exchange: Exchange; threadId: string }) {
  return (
    <article className="shrink-0 w-[42rem] max-w-[88vw] flex flex-col gap-5 glass-strong rounded-3xl p-8 self-start max-h-[calc(100dvh-10rem)] overflow-y-auto">
      {/* User question */}
      <header className="flex flex-col gap-2">
        <p className="text-eyebrow">You</p>
        <h2 className="text-display text-2xl md:text-3xl leading-snug text-bone-50">
          {exchange.question}
        </h2>
      </header>

      <div className="h-px bg-gradient-to-r from-white/[0.08] via-white/[0.04] to-transparent" />

      {/* Assistant answer */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-eyebrow inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-aurora-400" />
            MindeesAI
          </p>
          {exchange.answer && <ThumbActions threadId={threadId} messageId={exchange.id} />}
        </div>

        {exchange.reasoning && <ReasoningDisclosure text={exchange.reasoning} />}

        <div className="prose prose-invert max-w-none">
          {exchange.answer ? (
            <MessageMarkdown text={exchange.answer} />
          ) : (
            <ThinkingShimmer stage={exchange.stage} />
          )}
        </div>

        {exchange.toolActivity.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {exchange.toolActivity.map((t, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-full ${
                  t.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                }`}
              >
                <Wrench className="size-3" />
                {t.name} · {Math.round(t.ms)}ms
              </span>
            ))}
          </div>
        )}

        {exchange.citations.length > 0 && (
          <footer className="mt-3 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 mb-2">
              <BookText className="size-3.5 text-bone-500" />
              <p className="text-eyebrow">{trust.cite(exchange.citations.length)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {exchange.citations.map((c, i) => (
                <CitationPill key={`${c.url}-${i}`} idx={i + 1} citation={c} />
              ))}
            </div>
          </footer>
        )}
      </section>
    </article>
  );
}

// ─── Composer card (lives in the canvas, not floating) ─────────────────────

function ComposerCard({
  input,
  setInput,
  streaming,
  stage,
  onSubmit,
  onAbort,
}: {
  input: string;
  setInput: (s: string) => void;
  streaming: boolean;
  stage: string;
  onSubmit: (e: FormEvent) => void;
  onAbort: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 w-[26rem] max-w-[88vw] self-start glass-strong rounded-3xl p-6 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-eyebrow inline-flex items-center gap-2">
          <Sparkles className="size-3.5 text-aurora-400" />
          Compose
        </p>
        {streaming && <StagePill stage={stage} />}
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e as unknown as FormEvent);
          }
        }}
        rows={5}
        placeholder={streaming ? trust.thinking : "Ask anything…"}
        className="w-full resize-none bg-transparent outline-none text-bone-100 placeholder:text-bone-500 py-2 text-[15px] leading-relaxed"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-bone-500 font-mono">⏎ to send · Shift+⏎ for newline</p>
        {streaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="px-4 py-2 rounded-2xl glass hover:bg-white/[0.06] text-sm transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-5 py-2.5 rounded-2xl bg-bone-50 text-ink-950 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white transition-colors inline-flex items-center gap-1.5 text-sm"
          >
            Send
            <Send className="size-3.5" />
          </button>
        )}
      </div>
    </form>
  );
}

function StagePill({ stage }: { stage: string }) {
  let label: string = "Working…";
  if (stage === "context") label = trust.retrieving;
  else if (stage === "reasoning") label = "Reasoning…";
  else if (stage === "thinking") label = trust.thinking;
  else if (stage.startsWith("tool:")) label = trust.toolPending(stage.slice(5));
  else if (stage === "synthesising") label = trust.draftingFinal;
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-bone-300 font-mono">
      <span className="size-1.5 rounded-full bg-aurora-400 pulse-dot" />
      {label}
    </span>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <article className="shrink-0 w-[42rem] max-w-[88vw] self-start flex flex-col gap-6 p-8">
      <p className="text-eyebrow">A fresh thread</p>
      <h1 className="text-display text-4xl md:text-6xl leading-[1.05] text-bone-50">
        What's on your{" "}
        <em className="not-italic aurora-grad">mind</em>?
      </h1>
      <p className="text-bone-300 text-lg leading-relaxed max-w-md">
        MindeesAI remembers every conversation and trains on it. The next thing you ask makes the
        next answer measurably better.
      </p>
      <div className="flex flex-col gap-2 mt-4">
        <p className="text-eyebrow text-bone-500">Try asking</p>
        {[
          "What can you actually do?",
          "Search the web for the latest Next.js 16 release notes",
          "Explain how your self-improvement loop works",
        ].map((s) => (
          <p key={s} className="text-sm text-bone-300 italic">
            "{s}"
          </p>
        ))}
      </div>
    </article>
  );
}

function ReasoningDisclosure({ text }: { text: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-eyebrow inline-flex items-center gap-2 select-none hover:text-aurora-400 transition-colors">
        <span className="size-1.5 rounded-full bg-aurora-400" />
        Reasoning · {text.length} chars
      </summary>
      <div className="mt-3 rounded-xl border border-white/[0.06] bg-ink-800/40 p-4 text-[13px] leading-relaxed text-bone-300 font-mono whitespace-pre-wrap">
        {text}
      </div>
    </details>
  );
}

function ThinkingShimmer({ stage }: { stage?: string }) {
  let label: string = trust.thinking;
  if (stage === "context") label = "Loading your memory…";
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
    <div className="flex gap-1">
      <button
        aria-label="Thumb up"
        onClick={() => send("up")}
        className={`p-1.5 rounded-full hover:bg-white/[0.06] transition-colors ${
          signal === "up" ? "text-aurora-400" : "text-bone-500"
        }`}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        aria-label="Thumb down"
        onClick={() => send("down")}
        className={`p-1.5 rounded-full hover:bg-white/[0.06] transition-colors ${
          signal === "down" ? "text-danger" : "text-bone-500"
        }`}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </div>
  );
}
