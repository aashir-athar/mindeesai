/**
 * Wire types for the sidecar HTTP RPC.
 * MUST stay in sync with scripts/sidecar/src/types.ts.
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

export interface EmbedRequest { text: string; }
export interface EmbedResponse { vector: number[]; dim: number; }

export interface MemoryRecallRequest {
  query: string;
  k?: number;
  threadId?: string;
  table?: "memories" | "insights" | "research";
}
export interface MemoryRecallResponse { hits: RetrievalHit[]; }

export interface MemoryRememberRequest {
  records: MemoryRecord[];
  table?: "memories" | "insights" | "research";
}
export interface MemoryRememberResponse { inserted: number; }

export interface PiiSpan { type: string; start: number; end: number; score: number; }
export interface PiiRequest { text: string; }
export interface PiiResponse { redacted: string; spans: PiiSpan[]; detected: boolean; }

export type ClassifyTask = "sentiment" | "toxicity" | "ner" | "zero-shot";
export interface ClassifyRequest { task: ClassifyTask; text: string; labels?: string[]; }
export interface ClassifyLabelScore { label: string; score: number; }
export interface ClassifyEntity { entity: string; word: string; start: number; end: number; score: number; }
export interface ClassifyResponse {
  task: ClassifyTask;
  labels?: ClassifyLabelScore[];
  entities?: ClassifyEntity[];
}

export interface RerankRequest { query: string; documents: string[]; topK?: number; }
export interface RerankResponse {
  results: Array<{ index: number; document: string; score: number }>;
}

export interface SummarizeRequest { text: string; maxLength?: number; minLength?: number; }
export interface SummarizeResponse { summary: string; }
