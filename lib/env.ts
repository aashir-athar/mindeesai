/**
 * Centralised env access.
 * Read everything through this file so a missing variable shows up here and only here.
 */

const str = (k: string, fallback?: string): string | undefined =>
  process.env[k] && process.env[k]!.length > 0 ? process.env[k] : fallback;

const bool = (k: string, fallback = false): boolean => {
  const v = process.env[k];
  if (!v) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
};

export const env = {
  SITE_URL: str("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")!,
  CRON_SECRET: str("CRON_SECRET"),

  OLLAMA_BASE_URL: str("OLLAMA_BASE_URL", "http://localhost:11434")!,
  DEFAULT_CHAT_MODEL: str("DEFAULT_CHAT_MODEL", "deepseek-r1:32b")!,
  FAST_CHAT_MODEL: str("FAST_CHAT_MODEL", "llama3.1:8b")!,
  CODE_MODEL: str("CODE_MODEL", "qwen2.5-coder:32b")!,
  DEFAULT_EMBED_MODEL: str("DEFAULT_EMBED_MODEL", "nomic-embed-text:latest")!,

  ANTHROPIC_API_KEY: str("ANTHROPIC_API_KEY"),
  OPENAI_API_KEY: str("OPENAI_API_KEY"),
  XAI_API_KEY: str("XAI_API_KEY"),
  GROQ_API_KEY: str("GROQ_API_KEY"),
  GOOGLE_GENERATIVE_AI_API_KEY: str("GOOGLE_GENERATIVE_AI_API_KEY"),

  TAVILY_API_KEY: str("TAVILY_API_KEY"),
  EXA_API_KEY: str("EXA_API_KEY"),
  FIRECRAWL_API_KEY: str("FIRECRAWL_API_KEY"),
  JINA_API_KEY: str("JINA_API_KEY"),

  LANCEDB_PATH: str("LANCEDB_PATH", "./data/lancedb")!,
  /**
   * Auto-detected, in this priority:
   *   - If MEMORY_PERSISTENCE is explicitly set, honour it.
   *   - Else, if R2_* credentials are present (and we're on Vercel),
   *     default to "cloudflare-r2" — preferred over vercel-blob because
   *     R2's free tier offers 1M writes/mo (vs Hobby Blob's 2k/mo) and
   *     $0 egress forever.
   *   - Else, if BLOB_READ_WRITE_TOKEN is present (and we're on Vercel),
   *     default to "vercel-blob".
   *   - Else fall back to "local" (dev / self-hosted).
   *
   * The user's directive is "no configuration needed; user just chats."
   * Requiring them to manually set MEMORY_PERSISTENCE violated that —
   * and silently broke every audit page (journal/research/memory-graph
   * showed empty because /tmp resets per function invocation).
   */
  MEMORY_PERSISTENCE: (str("MEMORY_PERSISTENCE")
    ?? ((process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET && process.env.VERCEL === "1")
        ? "cloudflare-r2"
        : (process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL === "1")
          ? "vercel-blob"
          : "local")) as
    | "local"
    | "vercel-blob"
    | "cloudflare-r2"
    | "turso"
    | "external",
  BLOB_READ_WRITE_TOKEN: str("BLOB_READ_WRITE_TOKEN"),

  /** Cloudflare R2 (S3-compatible) storage. */
  R2_ACCOUNT_ID: str("R2_ACCOUNT_ID"),
  R2_BUCKET: str("R2_BUCKET"),
  R2_ACCESS_KEY_ID: str("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: str("R2_SECRET_ACCESS_KEY"),
  /** Public R2 hostname for read-only fetches (e.g. <bucket>.<hash>.r2.dev or a custom domain). Optional. */
  R2_PUBLIC_URL: str("R2_PUBLIC_URL"),

  /**
   * HuggingFace Hub — where the trained checkpoint lives.
   * Repo format: "<user>/<repo>", file is anchored at repo root.
   * On cold start, the native model loader fetches the checkpoint from
   * `https://huggingface.co/<HF_MODEL_REPO>/resolve/main/<HF_MODEL_FILE>`
   * and caches it to /tmp before loading. Public model, no auth needed.
   */
  HF_MODEL_REPO: str("HF_MODEL_REPO", "aashir-athar/mindeesai-base")!,
  HF_MODEL_FILE: str("HF_MODEL_FILE", "base.bin")!,
  HF_MODEL_REVISION: str("HF_MODEL_REVISION", "main")!,
  /** Optional HF token for writing to the repo (only used by the upload script). */
  HF_TOKEN: str("HF_TOKEN"),

  /**
   * Route /api/chat inference through the native Mindees transformer
   * instead of the cloud LLM router. Flip to true once a real checkpoint
   * has been loaded. Default: false (bootstrap teacher = Groq).
   */
  USE_NATIVE_MODEL: bool("USE_NATIVE_MODEL", false),

  ENABLE_WEB_RESEARCH: bool("ENABLE_WEB_RESEARCH", true),
  ENABLE_SELF_REFLECTION: bool("ENABLE_SELF_REFLECTION", true),
  ENABLE_CONNECTOR_SANDBOX: bool("ENABLE_CONNECTOR_SANDBOX", true),
  ENABLE_VISION: bool("ENABLE_VISION", false),
} as const;

/** Throw early if required env is missing in production. */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!env.CRON_SECRET) throw new Error("CRON_SECRET must be set in production");
}
