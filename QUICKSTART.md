# MindeesAI — Quickstart

Everything you need to know to get the model live. Short, dense, end-to-end.

---

## 1. What MindeesAI is

A **self-improving conversational AI** with persistent memory and an actual TypeScript transformer of its own. Three things make it different from "yet another LLM wrapper":

- **It has its own brain.** A decoder-only transformer (`core/mindees-mind/`) trained on your hardware via PyTorch (`scripts/train/pretrain.py`). Variants from `nano` (12M params) up to `home-max` (~349M, tuned for RTX 5070 12 GB). Once trained, the checkpoint is the inference engine — Groq is only the bootstrap teacher.
- **It learns continuously.** A cron tick fires every ~5 min and runs: reflection on recent chats → curiosity-driven autonomous research → journal entry → sleep-cycle consolidation → persistence flush. Heavy training runs weekly on local GPU (`run-home-max.ps1`) or free GitHub Actions CPU (`pretrain.yml`).
- **It has 23 persistent tensors** that evolve per turn — mood (8d), user-model (16d), relationship (4d), drift fingerprint, theory-of-mind beliefs, vocab mirror, conversation arc, sentiment arc, topic affinity, rhythm, delights, reach-out, inner voice, neural affect blend, sleep-cycle, and more. None of it is roleplay theatre — every tensor is inspectable at `/dashboard`.

The persona is "Mindees" — first-person, no "as an AI" register, leak-guarded at three layers (regex detector + re-anchor rewrite + final sanitizer).

---

## 2. The flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER BROWSER                                                       │
│  Next.js 16 + React 19 streaming SSE                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼  POST /api/chat
┌─────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR  (agents/orchestrator/index.ts)                       │
│                                                                     │
│  1. Append user turn → conversation transcript                      │
│  2. Read affect (rule + neural emotion + sentiment + toxicity)      │
│  3. Update mood, user-model, relationship, theory-of-mind, vocab    │
│  4. Recall in-thread + cross-thread memories (LanceDB rerank)       │
│  5. Build system prompt (every tensor narrated in)                  │
│  6. Pick inference engine:                                          │
│       USE_NATIVE_MODEL=true  → core/mindees-mind/ (YOUR weights)    │
│       USE_NATIVE_MODEL=false → 7-deep free-tier LLM fallback chain  │
│  7. Multi-hop tool loop (up to 5 hops, 17 connectors available)     │
│  8. Stream text + reasoning + citations back to UI                  │
│  9. Persist turn → distill corpus + R2 quick-flush                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼  every ~5 min (cron-job.org → /api/cron)
┌─────────────────────────────────────────────────────────────────────┐
│  CRON TICK  (agents/optimizer/index.ts)                             │
│                                                                     │
│  • Reflect on threads touched since last tick                       │
│  • Promote high-confidence insights to LanceDB                      │
│  • Autonomous research (Tavily/Exa/JINA/DDG/Wiki/arXiv/HN/Reddit)   │
│  • Maybe write a journal entry (once per ~22h)                      │
│  • Sleep-cycle consolidation                                        │
│  • Compose reach-out narrative                                      │
│  • Flush state → Cloudflare R2                                      │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼  weekly (.github/workflows/pretrain.yml)
┌─────────────────────────────────────────────────────────────────────┐
│  HEAVY TRAINING  (scripts/train/pretrain.py)                        │
│                                                                     │
│  • Reads data/distill-corpus.jsonl (every chat turn lives here)     │
│  • Reads data/distill-feedback.jsonl (👎 dropped, 👍 duplicated)    │
│  • MixedSampler over base corpus + distill + dialogue + TinyStories │
│  • SFT loss + persona-loss regularizer + DPO + GRPO                 │
│  • Writes checkpoints/base.bin                                      │
│  • python scripts/upload_to_hf.py → pushes to HuggingFace Hub       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼  on next Vercel cold start
┌─────────────────────────────────────────────────────────────────────┐
│  HF DOWNLOAD  (core/mindees-mind/model/hf-download.ts)              │
│  Fetches base.bin from HF → /tmp/checkpoints/base.bin               │
│  loadNativeCheckpoint() reads it and overlays trained weights       │
│  The next chat runs on YOUR model.                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Storage split (all free-tier):**

| Layer | Holds | Free-tier quota |
|---|---|---|
| HuggingFace Hub | `base.bin` checkpoint | unlimited public storage, $0 egress |
| Cloudflare R2 | LanceDB + persona tensors + conversations + journals | 10 GB / 1M writes / 10M reads / mo, $0 egress |
| Vercel Hobby | Compute only (chat + cron + audit pages) | 100 GB-hr compute, 100 GB bandwidth / mo |
| HF Hub also hosts | 4 transformers.js ML models (emotion, sentiment, NER, toxicity) — downloaded on first use, cached in /tmp |

---

## 3. What you have to do

### 3.1 Local development

```powershell
# 1. Clone + install
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai

# Generate Next.js scaffold (see docs/SETUP.md for the full install list)
npx create-next-app@latest . --typescript --tailwind --app --eslint --skip-install --import-alias "@/*"

npm install next@latest react@latest react-dom@latest `
            tailwindcss@latest framer-motion lucide-react clsx tailwind-merge class-variance-authority `
            @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-tooltip @radix-ui/react-scroll-area @radix-ui/react-dropdown-menu @radix-ui/react-tabs `
            cmdk sonner vaul next-themes geist zod nanoid `
            @lancedb/lancedb apache-arrow `
            @huggingface/transformers `
            @mendable/firecrawl-js cheerio `
            @vercel/blob

# 2. Configure
cp .env.example .env.local
#   → Edit .env.local — minimum is CRON_SECRET (run: openssl rand -hex 32)
#   → For local dev, leave MEMORY_PERSISTENCE=local (no R2 needed)

# 3. Bootstrap + run
node scripts/bootstrap.mjs
npm run dev               # → http://localhost:3000
```

### 3.2 Train the model

```powershell
# RTX 5070 12 GB profile — bf16 + gradient checkpointing
# Takes ~4 hours; produces checkpoints/base.bin
.\scripts\train\run-home-max.ps1

# (Or the free GitHub Actions path — Actions tab → "Pretrain MindeesAI" → Run workflow)
```

### 3.3 Push the model to HuggingFace

```powershell
pip install huggingface_hub
huggingface-cli login         # one-time, opens browser
python scripts\upload_to_hf.py
# → uploads checkpoints/base.bin → aashir-athar/mindeesai-base
```

### 3.4 Deploy to Vercel

1. **Create the project** — push the repo to GitHub, then `vercel.com/new` → import the repo. Hobby plan is fine.

2. **Set up Cloudflare R2** (one-time, ~3 min):
   - https://dash.cloudflare.com → R2 → **Create bucket** (name: `mindeesai`)
   - R2 → **Manage R2 API Tokens** → **Create API Token** → Object Read & Write → scope to your bucket
   - Copy: Account ID, Access Key ID, Secret Access Key

3. **Set env vars** in Vercel project settings (Settings → Environment Variables):

   | Variable | Required? | Value |
   |---|---|---|
   | `CRON_SECRET` | YES | 32-byte hex — generate with `openssl rand -hex 32` |
   | `R2_ACCOUNT_ID` | YES | from R2 dashboard |
   | `R2_BUCKET` | YES | `mindeesai` (or whatever you named the bucket) |
   | `R2_ACCESS_KEY_ID` | YES | from R2 API token |
   | `R2_SECRET_ACCESS_KEY` | YES | from R2 API token |
   | `HF_MODEL_REPO` | optional | default `aashir-athar/mindeesai-base` |
   | `GROQ_API_KEY` | optional | free at https://console.groq.com (LLM bootstrap) |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | optional | free at https://aistudio.google.com (LLM fallback #6/7) |
   | `TAVILY_API_KEY` | optional | free 1k/mo — better web search |
   | `FIRECRAWL_API_KEY` | optional | free — better page extraction |
   | `MEMORY_PERSISTENCE` | **leave UNSET** | auto-detects `cloudflare-r2` from R2 vars |
   | `BLOB_READ_WRITE_TOKEN` | **leave UNSET** | only set this if you skip R2 |

4. **Deploy** — Vercel will build and ship. First cold start fetches `base.bin` from HF and caches to `/tmp/checkpoints/`.

5. **Wire up cron-job.org** (one-time, free):
   - https://cron-job.org → Create cronjob
   - URL: `https://<your-project>.vercel.app/api/cron/self-improve?token=<your CRON_SECRET>`
   - Interval: **15 minutes** (Vercel Hobby's 100 GB-hr/mo budget supports this; 5 min is tight)
   - Method: GET

6. **Verify**:
   - Visit `https://<your-project>.vercel.app/setup` — colour-coded health board. Every row green = ready.
   - `/api/health` — check `lastTrainingTick` populates after the first cron run.
   - `/admin` → flip `USE_NATIVE_MODEL` on once `/api/inference-mode` shows `checkpoint_present: true`.
   - `/chat` — talk to it.
   - `/journal`, `/research`, `/memory-graph`, `/dashboard` — watch its mind populate.

---

## 4. The free-tier math (so you know where you stand)

At a **15-min cron** in production:

| Quota | Consumed | Budget | % used |
|---|---|---|---|
| R2 writes/mo | ~150k (30 PUTs × 4/hr × 24h × 30d × 2 from chat+cron) | 1,000,000 | 15% |
| R2 reads/mo | ~3k (cold starts × hydrate) | 10,000,000 | < 1% |
| Vercel function GB-hr/mo | ~32 (96 ticks/day × 40s × 1 GB / 3600) | 100 | 32% |
| HF egress | ~10 GB (10 cold starts/day × 350 MB) | unlimited | 0% |

Headroom for chat traffic + audit-page hits: 68% of Vercel GB-hours, 99% of R2 reads, 85% of R2 writes. Solid.

If you ever hit a wall, your remaining levers (in order of impact):
1. Drop cron-job.org interval to 30 min → halves Vercel function compute
2. Add data-bundle compression in `lib/memory/persistence.ts` (~30 PUTs → 3 PUTs per tick)
3. Move heavy cron work entirely to GitHub Actions (free 2k min/mo) and make Vercel read-mostly

---

## 5. Things to read next

| If you want to… | Read |
|---|---|
| Understand the architecture top to bottom | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| See the full env / install / scaffold story | [`docs/SETUP.md`](docs/SETUP.md) |
| Wire up Vercel + cron-job.org with screenshots | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Add a new connector (skill) | [`docs/CONNECTORS.md`](docs/CONNECTORS.md) |
| Know what's planned next | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Train on your local GPU | [`scripts/train/README.md`](scripts/train/README.md) |
