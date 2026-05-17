/**
 * MindeesAI sidecar HTTP server. Runs LanceDB + transformers.js on
 * Hugging Face Spaces. Called over HTTPS+Bearer by the main app
 * deployed on Cloudflare Workers.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { embed } from "./embeddings.js";
import { rememberMany, recall, lancedbHealth } from "./lancedb.js";
import {
  rerankerPipeline,
  sentimentPipeline,
  nerPipeline,
  toxicityPipeline,
  zeroShotPipeline,
  summarizerPipeline,
} from "./transformers-pool.js";
import { redactPii } from "./pii.js";
import type {
  EmbedRequest,
  EmbedResponse,
  MemoryRecallRequest,
  MemoryRecallResponse,
  MemoryRememberRequest,
  MemoryRememberResponse,
  PiiRequest,
  ClassifyRequest,
  ClassifyResponse,
  ClassifyLabelScore,
  ClassifyEntity,
  RerankRequest,
  RerankResponse,
  SummarizeRequest,
  SummarizeResponse,
} from "./types.js";

const PORT = Number(process.env.PORT ?? 7860);
const SIDECAR_AUTH_TOKEN = process.env.SIDECAR_AUTH_TOKEN ?? "";

if (!SIDECAR_AUTH_TOKEN) {
  console.error("[sidecar] FATAL: SIDECAR_AUTH_TOKEN env var is required");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[sidecar] ${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || req.path === "/") return next();
  const auth = req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== SIDECAR_AUTH_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

// ─── Health + root ──────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ name: "mindeesai-sidecar", status: "ok", version: "0.2.0" });
});

app.get("/health", async (_req, res) => {
  const db = await lancedbHealth();
  res.json({ ok: true, ts: new Date().toISOString(), lancedb: db });
});

// ─── Embeddings ─────────────────────────────────────────────────────────

app.post("/embed", async (req: Request<unknown, unknown, EmbedRequest>, res) => {
  const { text } = req.body ?? ({} as EmbedRequest);
  if (typeof text !== "string" || text.length === 0) {
    return res.status(400).json({ error: "missing_text" });
  }
  try {
    const vector = await embed(text);
    const body: EmbedResponse = { vector, dim: vector.length };
    res.json(body);
  } catch (e) {
    console.error("[/embed] failed:", e);
    res.status(500).json({ error: "embed_failed", message: (e as Error).message });
  }
});

// ─── Memory ────────────────────────────────────────────────────────────

app.post("/memory/recall", async (req: Request<unknown, unknown, MemoryRecallRequest>, res) => {
  const { query, k, threadId, table } = req.body ?? ({} as MemoryRecallRequest);
  if (typeof query !== "string" || query.length === 0) {
    return res.status(400).json({ error: "missing_query" });
  }
  try {
    const hits = await recall(query, { k, threadId, table });
    const body: MemoryRecallResponse = { hits };
    res.json(body);
  } catch (e) {
    console.error("[/memory/recall] failed:", e);
    res.status(500).json({ error: "recall_failed", message: (e as Error).message });
  }
});

app.post("/memory/remember", async (req: Request<unknown, unknown, MemoryRememberRequest>, res) => {
  const { records, table } = req.body ?? ({} as MemoryRememberRequest);
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "missing_records" });
  }
  try {
    const inserted = await rememberMany(records, table);
    const body: MemoryRememberResponse = { inserted };
    res.json(body);
  } catch (e) {
    console.error("[/memory/remember] failed:", e);
    res.status(500).json({ error: "remember_failed", message: (e as Error).message });
  }
});

app.post("/memory/promote", async (req: Request<unknown, unknown, MemoryRememberRequest>, res) => {
  const { records } = req.body ?? ({} as MemoryRememberRequest);
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "missing_records" });
  }
  try {
    const stamped = records.map((r) => ({ ...r, source: "insight" }));
    const inserted = await rememberMany(stamped, "insights");
    const body: MemoryRememberResponse = { inserted };
    res.json(body);
  } catch (e) {
    console.error("[/memory/promote] failed:", e);
    res.status(500).json({ error: "promote_failed", message: (e as Error).message });
  }
});

app.post("/memory/recall-insights", async (req: Request<unknown, unknown, MemoryRecallRequest>, res) => {
  const { query, k } = req.body ?? ({} as MemoryRecallRequest);
  if (typeof query !== "string" || query.length === 0) {
    return res.status(400).json({ error: "missing_query" });
  }
  try {
    const hits = await recall(query, { k, table: "insights" });
    const body: MemoryRecallResponse = { hits };
    res.json(body);
  } catch (e) {
    console.error("[/memory/recall-insights] failed:", e);
    res.status(500).json({ error: "recall_insights_failed", message: (e as Error).message });
  }
});

// ─── PII ───────────────────────────────────────────────────────────────

app.post("/pii", async (req: Request<unknown, unknown, PiiRequest>, res) => {
  const { text } = req.body ?? ({} as PiiRequest);
  if (typeof text !== "string") {
    return res.status(400).json({ error: "missing_text" });
  }
  try {
    res.json(await redactPii(text));
  } catch (e) {
    console.error("[/pii] failed:", e);
    res.status(500).json({ error: "pii_failed", message: (e as Error).message });
  }
});

// ─── Classify ──────────────────────────────────────────────────────────

type SentimentResult = Array<{ label: string; score: number }>;
type NERResult = Array<{ entity_group?: string; entity?: string; word?: string; start?: number; end?: number; score?: number }>;
type ZeroShotResult = { sequence: string; labels: string[]; scores: number[] };

app.post("/classify", async (req: Request<unknown, unknown, ClassifyRequest>, res) => {
  const { task, text, labels } = req.body ?? ({} as ClassifyRequest);
  if (!task || typeof text !== "string") {
    return res.status(400).json({ error: "missing_task_or_text" });
  }

  try {
    if (task === "sentiment") {
      const pl = await sentimentPipeline();
      if (!pl) return res.json({ task, labels: [] } satisfies ClassifyResponse);
      const out = (await pl(text, { topk: 5 } as unknown as object)) as unknown as SentimentResult;
      const arr = Array.isArray(out) ? out : [out as unknown as { label: string; score: number }];
      const body: ClassifyResponse = {
        task,
        labels: arr.map((r) => ({ label: r.label, score: r.score })) as ClassifyLabelScore[],
      };
      return res.json(body);
    }

    if (task === "toxicity") {
      const pl = await toxicityPipeline();
      if (!pl) return res.json({ task, labels: [] } satisfies ClassifyResponse);
      const out = (await pl(text, { topk: 6 } as unknown as object)) as unknown as SentimentResult;
      const arr = Array.isArray(out) ? out : [out as unknown as { label: string; score: number }];
      const body: ClassifyResponse = {
        task,
        labels: arr.map((r) => ({ label: r.label, score: r.score })) as ClassifyLabelScore[],
      };
      return res.json(body);
    }

    if (task === "ner") {
      const pl = await nerPipeline();
      if (!pl) return res.json({ task, entities: [] } satisfies ClassifyResponse);
      const raw = (await pl(text, { aggregation_strategy: "simple" } as unknown as object)) as unknown as NERResult;
      const entities: ClassifyEntity[] = Array.isArray(raw)
        ? raw.map((r) => ({
            entity: (r.entity_group ?? r.entity ?? "").toString(),
            word: (r.word ?? "").toString(),
            start: r.start ?? 0,
            end: r.end ?? 0,
            score: r.score ?? 0,
          }))
        : [];
      const body: ClassifyResponse = { task, entities };
      return res.json(body);
    }

    if (task === "zero-shot") {
      if (!Array.isArray(labels) || labels.length === 0) {
        return res.status(400).json({ error: "zero_shot_requires_labels" });
      }
      const pl = await zeroShotPipeline();
      if (!pl) return res.json({ task, labels: [] } satisfies ClassifyResponse);
      const out = (await pl(text, labels as unknown as object)) as unknown as ZeroShotResult;
      const scored = Array.isArray(out.labels)
        ? out.labels.map((label, i) => ({ label, score: out.scores[i] ?? 0 }))
        : [];
      const body: ClassifyResponse = { task, labels: scored as ClassifyLabelScore[] };
      return res.json(body);
    }

    return res.status(400).json({ error: "unknown_task", endpoint: "/classify" });
  } catch (e) {
    console.error("[/classify] failed:", e);
    res.status(500).json({ error: "classify_failed", message: (e as Error).message });
  }
});

// ─── Rerank ────────────────────────────────────────────────────────────

app.post("/rerank", async (req: Request<unknown, unknown, RerankRequest>, res) => {
  const { query, documents, topK } = req.body ?? ({} as RerankRequest);
  if (typeof query !== "string" || !Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: "missing_query_or_documents" });
  }
  try {
    const pl = await rerankerPipeline();
    if (!pl) {
      // No reranker available — return identity ordering with score 0.5.
      const body: RerankResponse = {
        results: documents.map((d, i) => ({ index: i, document: d, score: 0.5 })),
      };
      return res.json(body);
    }
    const scored: Array<{ index: number; document: string; score: number }> = [];
    // Cross-encoder rerankers want "query [SEP] doc" pairs. transformers.js
    // accepts {text, text_pair} for that.
    for (let i = 0; i < documents.length; i++) {
      const pair = { text: query, text_pair: documents[i] };
      const out = (await pl(pair as unknown as string)) as unknown as Array<{ label: string; score: number }>;
      const score = Array.isArray(out) && out[0] ? out[0].score : 0;
      scored.push({ index: i, document: documents[i]!, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const k = typeof topK === "number" && topK > 0 ? topK : scored.length;
    const body: RerankResponse = { results: scored.slice(0, k) };
    res.json(body);
  } catch (e) {
    console.error("[/rerank] failed:", e);
    res.status(500).json({ error: "rerank_failed", message: (e as Error).message });
  }
});

// ─── Summarize ─────────────────────────────────────────────────────────

app.post("/summarize", async (req: Request<unknown, unknown, SummarizeRequest>, res) => {
  const { text, maxLength, minLength } = req.body ?? ({} as SummarizeRequest);
  if (typeof text !== "string" || text.length === 0) {
    return res.status(400).json({ error: "missing_text" });
  }
  try {
    const pl = await summarizerPipeline();
    if (!pl) {
      // No summarizer available — return the first ~maxLength chars as a fallback.
      const cap = typeof maxLength === "number" ? maxLength : 256;
      const body: SummarizeResponse = { summary: text.slice(0, cap) };
      return res.json(body);
    }
    const out = (await pl(text, {
      max_length: maxLength ?? 142,
      min_length: minLength ?? 30,
    } as unknown as object)) as unknown as Array<{ summary_text?: string }>;
    const summary = (Array.isArray(out) && out[0]?.summary_text) || "";
    const body: SummarizeResponse = { summary };
    res.json(body);
  } catch (e) {
    console.error("[/summarize] failed:", e);
    res.status(500).json({ error: "summarize_failed", message: (e as Error).message });
  }
});

// ─── 404 + error ──────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[sidecar] unhandled:", err);
  res.status(500).json({ error: "internal", message: err.message });
});

app.listen(PORT, () => {
  console.log(`[sidecar] listening on :${PORT}`);
  console.log(`[sidecar] auth token length: ${SIDECAR_AUTH_TOKEN.length}`);
});
