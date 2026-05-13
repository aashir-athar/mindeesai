"use client";

/**
 * ChatCanvas — the horizontally-scrollable thinking space.
 *
 * Each user/assistant pair is a "card" on a panned canvas. New cards appear at
 * the right edge and the canvas auto-pans to keep them in view. Users can pan
 * left to revisit earlier exchanges or right to see the latest.
 *
 * Streaming state machine:
 *   idle → submitting → streaming(stage=thinking) → streaming(stage=tool|synth) → done | error
 *
 * Trust micro-copy is driven by `lib/psychology/trust.ts`.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Send, ChevronLeft, ChevronRight, ArrowLeft, ThumbsUp, ThumbsDown, BookText, Wrench } from "lucide-react";
import type { Citation } from "@/lib/types";
import { trust } from "@/lib/psychology/trust";
import { nid } from "@/lib/utils";
import { CitationPill } from "./citation-pill";
import { StageIndicator } from "./stage-indicator";
import { MessageMarkdown } from "./message-markdown";

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  toolActivity: Array<{ name: string; ok: boolean; ms: number }>;
  reasoning?: string;
  stage?: string;
};

export function ChatCanvas({ threadId }: { threadId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the canvas to the right edge when a new turn appears.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [turns.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const userTurn: Turn = { id: nid(), role: "user", content: text, citations: [], toolActivity: [] };
    const assistantTurn: Turn = { id: nid(), role: "assistant", content: "", citations: [], toolActivity: [], stage: "thinking" };
    setTurns((prev) => [...prev, userTurn, assistantTurn]);
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
        for (const ev of events) handleSSE(ev, assistantTurn.id);
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, content: (t.content || "") + `\n\n_Error: ${(e as Error).message}_`, stage: undefined }
              : t,
          ),
        );
      }
    } finally {
      setStreaming(false);
      setStage("");
      abortRef.current = null;
    }
  }

  function handleSSE(block: string, assistantId: string) {
    const eventLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) return;
    const event = eventLine.slice(6).trim();
    const data = JSON.parse(dataLine.slice(5).trim());

    switch (event) {
      case "stage":
        setStage(data.stage);
        setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, stage: data.stage } : t)));
        break;
      case "reasoning":
        setTurns((prev) =>
          prev.map((t) => (t.id === assistantId ? { ...t, reasoning: (t.reasoning ?? "") + (data.text ?? "") } : t)),
        );
        break;
      case "text":
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, content: (t.content || "") + (data.text ?? "") } : t,
          ),
        );
        break;
      case "tool-start":
        setStage(`tool:${data.name}`);
        break;
      case "tool-end":
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, toolActivity: [...t.toolActivity, { name: data.name, ok: data.ok, ms: data.ms }] }
              : t,
          ),
        );
        break;
      case "citation":
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, citations: [...t.citations, data.citation as Citation] } : t,
          ),
        );
        break;
      case "finish":
        setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, stage: undefined } : t)));
        break;
      case "error":
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, content: (t.content || "") + `\n_Error: ${data.error}_`, stage: undefined }
              : t,
          ),
        );
        break;
    }
  }

  return (
    <main className="relative min-h-dvh flex flex-col">
      {/* Top bar */}
      <header className="fixed top-0 inset-x-0 z-30 px-6 py-4 flex items-center justify-between border-b border-white/[0.06] glass">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-bone-300 hover:text-bone-100 transition-colors inline-flex items-center gap-1.5 text-sm">
            <ArrowLeft className="size-4" />
            Home
          </Link>
          <span className="text-bone-500 text-sm font-mono">thread {threadId.slice(0, 8)}</span>
        </div>
        <Link href="/chat" className="text-sm text-bone-300 hover:text-bone-100 transition-colors">+ new thread</Link>
      </header>

      {/* The horizontal-scroll canvas */}
      <div ref={canvasRef} className="horizontal-scroll flex-1 pt-24 pb-44 items-stretch">
        {turns.length === 0 && <EmptyState />}
        {turns.map((t) => (
          <Card key={t.id} turn={t} threadId={threadId} />
        ))}
        <div className="min-w-16" aria-hidden />
      </div>

      {/* Composer */}
      <form
        onSubmit={send}
        className="fixed bottom-0 inset-x-0 px-6 pb-6 pt-3 bg-gradient-to-t from-ink-950 via-ink-950 to-transparent"
      >
        <div className="mx-auto max-w-3xl glass-strong rounded-3xl flex items-end gap-2 p-3 pl-5">
          {streaming && stage && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2">
              <StageIndicator stage={stage} />
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(e as unknown as FormEvent);
              }
            }}
            rows={1}
            placeholder={streaming ? trust.thinking : "Ask anything — MindeesAI is listening."}
            className="flex-1 resize-none bg-transparent outline-none text-bone-100 placeholder:text-bone-500 py-2.5 text-[15px] leading-relaxed max-h-40"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="px-4 py-2.5 rounded-2xl glass hover:bg-white/[0.06] text-sm transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2.5 rounded-2xl bg-bone-50 text-ink-950 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white transition-colors inline-flex items-center gap-1.5 text-sm"
            >
              Send
              <Send className="size-3.5" />
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start justify-center w-[36rem] max-w-[90vw] gap-6 reveal-up">
      <p className="text-eyebrow">A fresh thread</p>
      <h1 className="text-display text-4xl md:text-5xl">
        What's on your <em className="not-italic aurora-grad">mind</em>?
      </h1>
      <p className="text-bone-300 text-lg leading-relaxed">
        MindeesAI remembers every conversation and trains on it. The next thing you ask makes the next answer measurably better.
      </p>
    </div>
  );
}

function Card({ turn, threadId }: { turn: Turn; threadId: string }) {
  return (
    <article
      className={`flex flex-col gap-3 w-[36rem] max-w-[90vw] glass-strong rounded-3xl p-7 ${
        turn.role === "user" ? "border-aurora-400/30" : ""
      }`}
    >
      <header className="flex items-center justify-between">
        <p className="text-eyebrow">
          {turn.role === "user" ? "You" : "MindeesAI"}
        </p>
        {turn.role === "assistant" && (
          <ThumbActions threadId={threadId} messageId={turn.id} />
        )}
      </header>
      {turn.role === "user" ? (
        <p className="text-display text-2xl leading-snug">{turn.content}</p>
      ) : (
        <div className="prose prose-invert max-w-none">
          {turn.reasoning && <ReasoningDisclosure text={turn.reasoning} />}
          {turn.content ? <MessageMarkdown text={turn.content} /> : <ThinkingShimmer stage={turn.stage} />}
        </div>
      )}

      {turn.toolActivity.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {turn.toolActivity.map((t, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-full ${
                t.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
              }`}
            >
              <Wrench className="size-3" />
              {t.name} · {t.ms.toFixed(0)}ms
            </span>
          ))}
        </div>
      )}

      {turn.citations.length > 0 && (
        <footer className="mt-2 pt-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <BookText className="size-3.5 text-bone-500" />
            <p className="text-eyebrow">{trust.cite(turn.citations.length)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {turn.citations.map((c, i) => (
              <CitationPill key={`${c.url}-${i}`} idx={i + 1} citation={c} />
            ))}
          </div>
        </footer>
      )}
    </article>
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
        className={`p-1.5 rounded-full hover:bg-white/[0.06] ${signal === "up" ? "text-aurora-400" : "text-bone-500"}`}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        aria-label="Thumb down"
        onClick={() => send("down")}
        className={`p-1.5 rounded-full hover:bg-white/[0.06] ${signal === "down" ? "text-danger" : "text-bone-500"}`}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </div>
  );
}

function ReasoningDisclosure({ text }: { text: string }) {
  return (
    <details className="mb-4 group">
      <summary className="cursor-pointer text-eyebrow inline-flex items-center gap-2 select-none hover:text-aurora-400 transition-colors">
        <span className="size-1.5 rounded-full bg-aurora-400" />
        Reasoning · {text.length} chars · click to expand
      </summary>
      <div className="mt-3 rounded-xl border border-white/[0.06] bg-ink-800/40 p-4 text-[13px] leading-relaxed text-bone-300 font-mono whitespace-pre-wrap">
        {text}
      </div>
    </details>
  );
}

function ThinkingShimmer({ stage }: { stage?: string }) {
  return (
    <div className="flex items-center gap-2 text-bone-500 text-sm">
      <span className="size-2 rounded-full bg-aurora-400 pulse-dot" />
      <span>
        {stage === "context" && "Loading your memory…"}
        {stage === "reasoning" && "Reasoning step-by-step…"}
        {stage === "thinking" && trust.thinking}
        {stage?.startsWith("tool:") && trust.toolPending(stage.slice(5))}
        {(!stage || stage === "synthesising") && trust.draftingFinal}
      </span>
    </div>
  );
}
