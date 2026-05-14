/**
 * POST /api/chat
 *
 * Streams an SSE response of orchestrator events.
 *
 * Request:
 *   { threadId: string, message: string }
 *
 * Response stream (one SSE event per orchestrator event):
 *   event: stage   data: {"stage":"thinking"}
 *   event: text    data: {"text":"..."}
 *   event: tool-start  data: {"name":"web-search","args":{},"callId":"..."}
 *   event: tool-end    data: {"name":"...","callId":"...","ok":true,"ms":120}
 *   event: citation    data: {...Citation}
 *   event: finish      data: {...Message}
 */

import { NextRequest } from "next/server";
import { orchestrate } from "@/agents/orchestrator";
import { ensureLanceDBReady } from "@/lib/memory/persistence";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  threadId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  message: z.string().min(1).max(8000),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid body", detail: String(e) }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Critical for thread continuity on Vercel: each /api/chat call can hit
  // a different function instance with its own empty /tmp. Without
  // ensuring Blob hydration BEFORE the orchestrator reads the thread
  // file, follow-up questions read [] and the LLM has no prior context
  // ("you forgot the topic" bug). Idempotent — only the first call per
  // function instance does real work.
  await ensureLanceDBReady().catch(() => {});

  const encoder = new TextEncoder();
  const abortCtrl = new AbortController();
  req.signal.addEventListener("abort", () => abortCtrl.abort(req.signal.reason), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        for await (const ev of orchestrate({
          threadId: body.threadId,
          userMessage: body.message,
          signal: abortCtrl.signal,
        })) {
          writeEvent(ev.type, ev);
        }
      } catch (e) {
        writeEvent("error", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
