# MindeesAI — Architecture

> **One-sentence pitch:** A free, open-source, self-improving autonomous chat AI that learns from every conversation, researches the web on its own, and rewrites its own brain every 5 minutes.

---

## 1. Top-level system diagram

```
                            ┌────────────────────────────────────────────────┐
                            │                  USER BROWSER                  │
                            │   Next.js 16 App Router  •  React 19  •  RSC   │
                            └───────────────────────┬────────────────────────┘
                                                    │ Streaming (SSE / RSC)
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MINDEESAI EDGE / SERVER                                │
│                                                                                     │
│   /api/chat ────────► Orchestrator Agent ────────► Connectors (tool calls)          │
│        │                     │                          │                           │
│        │                     ├─► Memory  ◄────┐         ├─► web-search (Tavily)     │
│        │                     ├─► Research ────┤         ├─► web-crawl  (Firecrawl)  │
│        │                     ├─► Reflector  ──┤         ├─► code-exec  (sandbox)    │
│        │                     └─► Critic    ───┘         ├─► calculator             │
│        │                                                ├─► reflect                │
│        ▼                                                └─► <user-added folder>    │
│   LLM Router  ──► Ollama (local)  •  Grok  •  Claude  •  OpenAI  •  Groq           │
│        │                                                                            │
│        ▼                                                                            │
│   Streaming Encoder  ──►  SSE chunks  ──►  client tokens                            │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                                    ▲
                                                    │ every 5 minutes
                            ┌───────────────────────┴────────────────────────┐
                            │           cron-job.org webhook                 │
                            │   POST /api/cron/self-improve  (bearer auth)   │
                            └────────────────────────────────────────────────┘
                                                    │
                                                    ▼
                            ┌────────────────────────────────────────────────┐
                            │     SELF-IMPROVEMENT PIPELINE                  │
                            │   Harvest → Reflect → Score → Embed →          │
                            │   Rewrite system prompt → Tune retrieval →     │
                            │   Append improvement-log.jsonl                 │
                            └────────────────────────────────────────────────┘
                                                    │
                                                    ▼
                            ┌────────────────────────────────────────────────┐
                            │              PERSISTENCE LAYER                 │
                            │   LanceDB (vectors)  •  JSONL (events)         │
                            │   data/graph.json    •  data/system-prompt.json│
                            └────────────────────────────────────────────────┘
```

---

## 2. Request lifecycle (chat turn)

1. **User submits a message** from the chat canvas (`app/chat/[threadId]/page.tsx`).
2. **Client → Server Action** streams the message to `/api/chat` over a `ReadableStream`.
3. **Orchestrator** (`agents/orchestrator/index.ts`) is invoked with `{ thread, message, context }`.
4. **Context assembly** runs in parallel:
   - Short-term memory: last N turns in the thread
   - Long-term retrieval: top-K LanceDB matches against the user query embedding
   - Graph memory: 1-hop neighbours of any named entities
   - Active system prompt: read from `data/system-prompt.json` (regenerated every 5 min)
5. **Tool planning** — the LLM decides whether to call connectors. Connector calls run with bounded concurrency.
6. **Synthesis** — the LLM streams the final answer, with inline citations from research/memory.
7. **Persistence** — the turn is appended to `data/conversations/<threadId>.jsonl` for the next reflection cycle.

---

## 3. Memory architecture

| Layer | Storage | TTL | Purpose |
|---|---|---|---|
| Short-term | In-memory `Map<threadId, Turn[]>` | Process lifetime | Cheap recency for the current thread |
| Working set | `data/conversations/<threadId>.jsonl` | Permanent | Source of truth for one conversation |
| Long-term vector | LanceDB `memories` table | Permanent | Semantic recall across all threads |
| Graph | `data/graph.json` | Permanent | Entity relationships (person → topic → fact) |
| Reflections | `data/reflections/*.jsonl` | Permanent | Distilled insights from past conversations |
| Insights (promoted) | LanceDB `insights` table | Permanent | High-confidence reflections, embedded for retrieval |

---

## 4. The self-improvement loop (the magic)

cron-job.org → `POST /api/cron/self-improve` every 5 min.

```
1. Harvest         data/conversations/*.jsonl (modified in last 5 min)
2. Reflect         each thread → {insight, evidence, confidence, retrieval_tag}
3. Score / filter  keep confidence ≥ 0.7 AND evidence present
4. Embed           push to LanceDB `insights`
5. Rewrite prompt  blend base prompt + top-N insights → data/system-prompt.json
6. Tune retrieval  bump retrieval-weights.json for tags that improved user signals
7. Archive         snapshot prior prompt to data/system-prompt-archive/<ts>.json
8. Log             append to data/improvement-log.jsonl
```

Every step is idempotent — re-running the same cron tick is safe.

---

## 5. Connector contract

```
/connectors/<name>/
  manifest.json       # name, description, JSON-schema params, version, permissions
  handler.ts          # export default async handler(args, ctx)
  prompt.md           # optional extra instructions for the LLM when this tool is in scope
  README.md           # optional user-facing docs
```

Connectors are auto-discovered at boot by `lib/connectors/loader.ts`. To add one, drop a folder. No other code changes.

---

## 6. Module ownership

| Folder | Owns |
|---|---|
| `app/` | Routes, layouts, server actions, API handlers |
| `components/` | All React UI (split into `ui/`, `chat/`, `marketing/`, `canvas/`, `connectors/`) |
| `lib/llm/` | Provider abstraction + streaming router |
| `lib/embeddings/` | Embedding-model abstraction (Ollama, transformers.js fallback) |
| `lib/memory/` | LanceDB client, JSONL appenders, graph reader/writer |
| `lib/research/` | Tavily/Exa search, Firecrawl/Jina crawl, reranker |
| `lib/connectors/` | Discovery, validation, registry, runtime |
| `lib/prompts/` | Base system prompt, reflection prompts, critic prompts |
| `lib/psychology/` | 2026 copywriting helpers (loss aversion, social proof, scarcity, etc.) |
| `agents/` | Orchestrator, researcher, reflector, optimizer, critic |
| `connectors/` | First-party plugins + user-added plugins |
| `data/` | Runtime persistence (gitignored except `.gitkeep`) |
| `scripts/` | One-off scripts (bootstrap, backfill, export) |
