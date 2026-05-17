/**
 * MindeesAI sidecar HTTP server.
 *
 * Hosts the native-binary ML and vector workloads that Cloudflare Workers
 * cannot execute. Called over HTTPS by the main app deployed on Workers.
 *
 * Endpoints (all POST, all JSON, all require Bearer auth):
 *   /health                 — liveness probe (no auth)
 *   /embed                  — text → 384-dim BGE-small vector
 *   /memory/recall          — vector top-K over LanceDB memories table
 *   /memory/remember        — insert into memories table
 *   /memory/promote         — insert into insights table
 *   /memory/recall-insights — vector top-K over insights table
 *   /pii                    — piiranha PII detection + redaction
 *   /classify               — zero-shot / sentiment / toxicity / NER
 *   /rerank                 — ms-marco cross-encoder reranking
 *   /summarize              — distilbart abstractive summary
 *
 * Phase 1 status: ALL endpoints return 501 NOT_IMPLEMENTED. Subsequent
 * phases (P2, P3) wire up LanceDB and transformers.js progressively.
 */

import express, { type Request, type Response, type NextFunction } from "express";

const PORT = Number(process.env.PORT ?? 7860);
const SIDECAR_AUTH_TOKEN = process.env.SIDECAR_AUTH_TOKEN ?? "";

if (!SIDECAR_AUTH_TOKEN) {
  // Hard refuse to boot without an auth token. A public HF Space without
  // auth would be an open-relay for whoever finds the URL.
  console.error("[sidecar] FATAL: SIDECAR_AUTH_TOKEN env var is required");
  process.exit(1);
}

const app = express();

// JSON body limit raised to 4 MB — transformers.js inputs can be long-form
// text (summarisation, multi-doc rerank).
app.use(express.json({ limit: "4mb" }));

// Minimal request log — useful while debugging HF Space cold-starts.
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[sidecar] ${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Bearer auth middleware. Skipped on /health so HF Spaces' own readiness
// probe doesn't get rejected.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || req.path === "/") {
    return next();
  }
  const auth = req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== SIDECAR_AUTH_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

// ─── Health + root ──────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({
    name: "mindeesai-sidecar",
    status: "ok",
    phase: 1,
    message: "Skeleton. Endpoints will be wired up in P2/P3.",
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ─── Stub endpoints (P2/P3 will implement) ──────────────────────────────

function notImplemented(req: Request, res: Response) {
  res.status(501).json({
    error: "not_implemented",
    endpoint: req.path,
    phase: "P2/P3 will implement this",
  });
}

// P2 will implement these (embeddings + LanceDB)
app.post("/embed", notImplemented);
app.post("/memory/recall", notImplemented);
app.post("/memory/remember", notImplemented);
app.post("/memory/promote", notImplemented);
app.post("/memory/recall-insights", notImplemented);

// P3 will implement these (transformers.js classifiers)
app.post("/pii", notImplemented);
app.post("/classify", notImplemented);
app.post("/rerank", notImplemented);
app.post("/summarize", notImplemented);

// ─── Fallback ───────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

// Express error handler.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[sidecar] unhandled:", err);
  res.status(500).json({ error: "internal", message: err.message });
});

app.listen(PORT, () => {
  console.log(`[sidecar] listening on :${PORT}`);
  console.log(`[sidecar] auth: ${SIDECAR_AUTH_TOKEN.slice(0, 4)}…${SIDECAR_AUTH_TOKEN.slice(-2)} (length ${SIDECAR_AUTH_TOKEN.length})`);
});
