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
   * Auto-detected:
   *   - If MEMORY_PERSISTENCE is explicitly set, honour it.
   *   - Else, if BLOB_READ_WRITE_TOKEN is present AND we're on Vercel,
   *     default to "vercel-blob" — the only mode that actually persists
   *     between serverless function invocations on Vercel.
   *   - Else fall back to "local" (dev / self-hosted).
   *
   * The user's directive is "no configuration needed; user just chats."
   * Requiring them to manually set MEMORY_PERSISTENCE=vercel-blob in
   * addition to providing the Blob token violated that — and silently
   * broke every audit page (journal/research/memory-graph showed empty
   * because /tmp resets per function invocation).
   */
  MEMORY_PERSISTENCE: (str("MEMORY_PERSISTENCE")
    ?? ((process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL === "1")
        ? "vercel-blob"
        : "local")) as
    | "local"
    | "vercel-blob"
    | "turso"
    | "external",
  BLOB_READ_WRITE_TOKEN: str("BLOB_READ_WRITE_TOKEN"),

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
