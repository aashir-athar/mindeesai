/**
 * Wire types — must match `lib/sidecar/types.ts` in the main app.
 * Any change to a request/response shape needs to land in both places.
 */

export interface MemoryRecord {
  id: string;
  text: string;
  vector?: number[];
  threadId?: string;
  role?: "user" | "assistant" | "system" | "tool";
  tags?: string[];
  source?: "conversation" | "insight" | "research" | string;
  createdAt: string;
}

export interface RetrievalHit extends MemoryRecord {
  vector: number[];
  score: number;
}

// ─── Embed ─────────────────────────────────────────────────────────────

export interface EmbedRequest {
  text: string;
}

export interface EmbedResponse {
  vector: number[];
  dim: number;
}

// ─── Memory ────────────────────────────────────────────────────────────

export interface MemoryRecallRequest {
  query: string;
  k?: number;
  threadId?: string;
  table?: "memories" | "insights" | "research";
}

export interface MemoryRecallResponse {
  hits: RetrievalHit[];
}

export interface MemoryRememberRequest {
  records: MemoryRecord[];
  table?: "memories" | "insights" | "research";
}

export interface MemoryRememberResponse {
  inserted: number;
}

// ─── PII ───────────────────────────────────────────────────────────────

export interface PiiSpan {
  type: string;
  start: number;
  end: number;
  score: number;
}

export interface PiiRequest {
  text: string;
}

export interface PiiResponse {
  redacted: string;
  spans: PiiSpan[];
  detected: boolean;
}

// ─── Classify ──────────────────────────────────────────────────────────

export type ClassifyTask = "sentiment" | "toxicity" | "ner" | "zero-shot";

export interface ClassifyRequest {
  task: ClassifyTask;
  text: string;
  /** Required for zero-shot. */
  labels?: string[];
}

export interface ClassifyLabelScore {
  label: string;
  score: number;
}

export interface ClassifyEntity {
  entity: string;
  word: string;
  start: number;
  end: number;
  score: number;
}

export interface ClassifyResponse {
  task: ClassifyTask;
  labels?: ClassifyLabelScore[];
  entities?: ClassifyEntity[];
}

// ─── Rerank ────────────────────────────────────────────────────────────

export interface RerankRequest {
  query: string;
  documents: string[];
  topK?: number;
}

export interface RerankResponse {
  results: Array<{ index: number; document: string; score: number }>;
}

// ─── Summarize ─────────────────────────────────────────────────────────

export interface SummarizeRequest {
  text: string;
  maxLength?: number;
  minLength?: number;
}

export interface SummarizeResponse {
  summary: string;
}

// ─── Error envelope (all 4xx/5xx) ──────────────────────────────────────

export interface ErrorResponse {
  error: string;
  message?: string;
  endpoint?: string;
}
