/**
 * Cross-module shared types.
 *
 * Keep this file authoritative — every other module imports from here rather than
 * defining its own near-duplicates. Type drift is the #1 source of LLM-output bugs.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Chat primitives
// ─────────────────────────────────────────────────────────────────────────────

export const RoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type Role = z.infer<typeof RoleSchema>;

export const CitationSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
  source: z.enum(["web", "memory", "reflection", "user"]).default("web"),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  role: RoleSchema,
  content: z.string(),
  citations: z.array(CitationSchema).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(), // present when role === "tool"
  createdAt: z.string(),
  modelId: z.string().optional(),
  // The reflection token budget the LLM thought it spent on this message.
  thinkingTokens: z.number().int().nonnegative().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Hint to the orchestrator (user-overridable).
  preferredModel: z.string().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// LLM router
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderId =
  | "ollama"
  | "anthropic"
  | "openai"
  | "xai"
  | "groq"
  | "google";

export interface LLMRequest {
  modelId?: string;          // explicit override (e.g. "deepseek-r1:32b")
  messages: Message[];
  system?: string;
  tools?: ToolDescriptor[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** When true, ask the provider to surface its chain-of-thought (Ollama / R1 / o-series). */
  thinking?: boolean;
}

export interface LLMStreamChunk {
  type: "text" | "tool-call" | "thinking" | "finish";
  text?: string;
  toolCall?: ToolCall;
  /** Estimated tokens consumed since start of this stream. */
  tokens?: number;
}

export interface LLMProvider {
  id: ProviderId;
  /** Cheap check — does this provider have credentials configured? */
  isAvailable(): boolean;
  /** Streaming completion. Yields chunks until exhausted. */
  stream(req: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools / connectors
// ─────────────────────────────────────────────────────────────────────────────

export const ConnectorManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
  version: z.string(),
  description: z.string().min(8),
  parameters: z
    .object({
      type: z.literal("object"),
      properties: z.record(z.any()),
      required: z.array(z.string()).optional(),
    })
    .passthrough(),
  permissions: z
    .array(
      z.enum([
        "network",
        "filesystem-read",
        "filesystem-write",
        "child-process",
      ]),
    )
    .default([]),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
});
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;

export type ToolDescriptor = {
  name: string;
  description: string;
  parameters: ConnectorManifest["parameters"];
};

export type ConnectorContext = {
  fetch: typeof fetch;
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  user?: { id: string };
};

export type ConnectorResult =
  | { ok: true; output: unknown; citations?: Citation[]; tokens?: number }
  | { ok: false; error: string; retryable?: boolean };

export type ConnectorHandler<A = unknown> = (
  args: A,
  ctx: ConnectorContext,
) => Promise<ConnectorResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryRecord = {
  id: string;
  text: string;
  vector?: number[];
  threadId?: string;
  role?: Role;
  tags?: string[];
  source?: "conversation" | "reflection" | "insight" | "research";
  createdAt: string;
};

export type RetrievalHit = MemoryRecord & { score: number };

export type Reflection = {
  id: string;
  threadId: string;
  insight: string;
  evidence: string;
  confidence: number;
  retrievalTag: string;
  createdAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Research
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchHit = {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedAt?: string;
};

export type CrawledPage = {
  url: string;
  title?: string;
  text: string;
  fetchedAt: string;
  /** Approximate token count of `text` (used for budgeting downstream). */
  tokens?: number;
};
