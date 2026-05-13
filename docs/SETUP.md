# MindeesAI — Setup

> Following the project rule, this guide emits **install commands only** — never edits to `package.json` directly. Run the commands below in order from a fresh shell.

---

## 0. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 LTS or 24 | Required by Next.js 16 |
| pnpm (or bun) | 9.x (or 1.2+) | Faster installs + workspace support |
| Ollama | latest | Runs local LLMs (free path) |
| Git | latest | Cloning, branching |

Install Ollama once: <https://ollama.com/download> — then pull the models you want:

```bash
ollama pull deepseek-r1:32b           # primary reasoning model
ollama pull qwen2.5-coder:32b         # code specialist
ollama pull llama3.1:8b               # fast chat model
ollama pull nomic-embed-text:latest   # default embedding model
```

If you have less RAM, swap `:32b` → `:7b` everywhere.

---

## 1. Clone

```bash
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai
```

---

## 2. Create the Next.js 16 base

> We do **not** check in a generated `package.json` for you. Run this once:

```bash
# Pick ONE of the two installers.
pnpm dlx create-next-app@latest . \
  --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-pnpm \
  --skip-install

# or with bun:
bunx create-next-app@latest . \
  --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-bun \
  --skip-install
```

Answer **No** if it asks to overwrite existing files. The CLI is only generating the scaffolding (`tsconfig.json`, `next.config.ts`, etc.) — the rest of the repo already has the working code.

---

## 3. Install dependencies

```bash
pnpm add next@latest react@latest react-dom@latest

# UI
pnpm add tailwindcss@latest @tailwindcss/postcss postcss
pnpm add framer-motion lucide-react clsx tailwind-merge class-variance-authority
pnpm add @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-tooltip \
        @radix-ui/react-scroll-area @radix-ui/react-dropdown-menu @radix-ui/react-tabs
pnpm add cmdk sonner vaul next-themes
pnpm add geist

# AI / streaming
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/xai ollama-ai-provider
pnpm add zod nanoid

# Memory
pnpm add @lancedb/lancedb apache-arrow

# Embeddings (local fallback when Ollama is absent)
pnpm add @huggingface/transformers

# Research
pnpm add @mendable/firecrawl-js cheerio

# Vercel persistence (only required when MEMORY_PERSISTENCE=vercel-blob)
pnpm add @vercel/blob

# Dev
pnpm add -D typescript@latest @types/node@latest @types/react@latest @types/react-dom@latest
pnpm add -D eslint eslint-config-next prettier prettier-plugin-tailwindcss
pnpm add -D vitest @vitest/ui
```

(Swap `pnpm add` → `bun add` if you prefer bun.)

---

## 4. shadcn/ui

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button card dialog dropdown-menu input scroll-area separator \
                          sheet sonner tabs textarea tooltip badge skeleton
```

---

## 5. Environment

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in:
- `OLLAMA_BASE_URL` (defaults to `http://localhost:11434`)
- `TAVILY_API_KEY` (free at <https://tavily.com>)
- `FIRECRAWL_API_KEY` (free tier at <https://firecrawl.dev>) — or leave blank and Jina Reader is used
- `CRON_SECRET` — generate with `openssl rand -hex 32`
- Optional fallbacks: `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`

---

## 6. Bootstrap data folders

```bash
node scripts/bootstrap.mjs
```

This creates LanceDB tables and writes the initial `data/system-prompt.json`.

---

## 7. Run

```bash
pnpm dev
```

Open <http://localhost:3000>.

---

## 8. Wire up cron-job.org

1. Sign in at <https://cron-job.org>
2. **Create cronjob**
3. URL: `https://<your-vercel-domain>/api/cron/self-improve`
4. Schedule: `Every 5 minutes`
5. Request method: `POST`
6. Headers: `Authorization: Bearer <your-CRON_SECRET>`
7. Save & enable.

You can verify locally with:

```bash
curl -X POST http://localhost:3000/api/cron/self-improve \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## 9. Deploy

```bash
pnpm dlx vercel deploy --prod
```

Add the same env vars in the Vercel dashboard. Set `OLLAMA_BASE_URL` to a public Ollama host (or omit it and provide a hosted-LLM key — the router will fall back).
