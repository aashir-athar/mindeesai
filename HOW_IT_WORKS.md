# How MindeesAI Works — in plain English

A short tour of every moving part. No jargon unless I have to use it, and when I do I'll explain it.

---

## 1. What is MindeesAI?

It's a chat AI that **trains its own brain** instead of just renting one. Most chatbots are wrappers around someone else's model (Claude, ChatGPT, etc.) — you talk, they pass your message to the big company's servers, the big company answers, and the wrapper just decorates the reply. MindeesAI does have those big models as a backup, but it also has **its own custom-built neural network** (~280 million parameters, trained from scratch on your conversations) that grows smarter every week.

The whole project is free to run, free to deploy, and 100% open-source.

---

## 2. Where things live (the 4 layers)

| Layer | What it holds | Why this one |
|---|---|---|
| **Your computer (RTX 5070)** | Trains the brain. Heavy compute. | You own a GPU — use it. |
| **HuggingFace Hub** | The trained brain file (`base.bin`, ~600 MB). | Unlimited free hosting for public AI models. |
| **Cloudflare R2** | Conversations, memory, journals, knowledge graph. | 10 GB / 1M writes/month free, and free to download. |
| **Vercel** | The website + chat API. | Free hosting for Next.js apps. |

Think of it like this:

- **HuggingFace** = the brain in a jar
- **Cloudflare R2** = the diary and notebook the brain reads from
- **Vercel** = the body that lets the brain talk to you on a webpage
- **Your PC** = the school where the brain learns new things

---

## 3. What happens when you send a chat message

When you type a message and hit send on the deployed website, here's the exact sequence:

```
1. You type "what do you know about Pakistan economy?"

2. Your browser → Vercel /api/chat

3. Vercel function spins up. If this is the first request in a while
   (cold start), it does these one-time things:
     - Downloads base.bin from HuggingFace (cached after first time)
     - Loads the memory database from R2
   This takes ~3-5 seconds the first time, then milliseconds after.

4. The Orchestrator (the "main loop") does, in order:
     a. Saves your message to the conversation file (sent to R2 too)
     b. Reads your mood from your words (3 small AI models look at
        emotion, sentiment, toxicity)
     c. Updates 23 invisible "tensors" that track who you are, how
        you talk, what you care about, what mood Mindees is in, etc.
     d. Searches memory for related past conversations (uses an
        embedding model + a reranker model to find the best matches)
     e. Classifies your topic — is this code? math? personal?
        creative? factual? (zero-shot topic router model)
     f. Builds a SYSTEM PROMPT that bundles every tensor + memory hit
        + topic hint into one big instruction for the brain
     g. Picks which brain to use:
        - Your own MindeesAI model (if checkpoint is loaded + flag is on)
        - OR Groq / Google fallback chain (7 cloud models in priority order)
     h. Streams the reply back to you token-by-token
     i. If the brain decides it needs a tool (web search, calculator,
        github search, etc.), it pauses, runs the tool, reads the
        result, and continues the reply

5. After the reply is done:
     - The PII guard scrubs emails, phone numbers, etc. from BOTH
       your message and the reply
     - The cleaned pair gets written to data/distill-corpus.jsonl
       (this is the training data for future retrains)
     - All 23 tensors get pushed to R2 so your next chat (even on
       a different server) remembers everything
```

Total round-trip: usually under 3 seconds for the first word, then streaming.

---

## 4. What happens in the background

There are **two background loops** that keep the brain learning even when you're not chatting:

### The 15-minute tick (cron-job.org → Vercel)

Every 15 minutes, an external free service ([cron-job.org](https://cron-job.org)) hits `/api/cron/self-improve` on your Vercel deployment. That endpoint:

1. **Reflects** on threads that had activity since the last tick. Pulls out things the user kept coming back to, things the model hedged on, things that worked well. Writes these as "insights."
2. **Promotes** high-confidence insights into the long-term memory database.
3. **Researches** topics Mindees is curious about. Uses Tavily / Wikipedia / arXiv / etc. to find content, stores it as memory so next time the topic comes up, Mindees actually has substance.
4. **Writes a journal entry** about once every 22 hours — Mindees keeps a private diary of what mattered today, written to itself.
5. **Consolidates** repeated themes across many conversations (the "sleep cycle").
6. **Pushes everything** back to R2 so the next cold-start hydrates the latest state.

This loop is the difference between "the bot forgets you between sessions" and "the bot remembers you indefinitely."

### The weekly retrain (GitHub Actions)

Every Sunday at 03:00 UTC, a GitHub Actions workflow fires:

1. **Pulls** the latest `distill-corpus.jsonl` from Cloudflare R2 (all your conversation pairs since the last retrain, with PII already scrubbed).
2. **Trains** the `small` variant of MindeesAI for ~2000 steps on a free CPU runner. Takes 30-60 minutes.
3. **Pushes** the result to a side branch on HuggingFace called `small-weekly`. This NEVER overwrites your main brain (which holds your local-GPU training).
4. **Stops.** The next week it repeats.

This is a "sanity check" loop — it proves the data pipeline works end-to-end every week, and produces a small backup brain. The real heavy training still happens on your local RTX 5070.

---

## 5. How the brain gets smarter over time

Three nested learning loops, from fastest to slowest:

```
Per chat turn (seconds):
  ↓
  23 tensors update — mood, user model, vocab mirror, drift, etc.
  Memory database grows — every conversation becomes searchable
  Knowledge graph grows — facts about you AND about Mindees itself

Per cron tick (every 15 min):
  ↓
  Insights get promoted to long-term memory
  Autonomous research adds new knowledge
  Journal entries written
  All state pushed to R2

Per training run (weekly via GitHub Actions OR whenever YOU train):
  ↓
  The actual neural network weights get updated using gradient descent
  on the distill-corpus (every chat turn becomes a training example)
  Up-voted replies (👍) get duplicated, down-voted replies (👎) get dropped
  New base.bin pushed to HuggingFace
  Next cold-start picks up the new brain
```

Nothing here is roleplay — every tensor is real persistent state you can inspect at `/dashboard`. Every memory is a real vector in the database you can search at `/memory-graph`. Every research call lands in `/research`.

---

## 6. The brain itself (in simple terms)

A neural network with ~280 million tunable numbers (the "parameters" or "weights"). For comparison:
- This brain: 280 million
- GPT-3.5: ~175 billion (~625× bigger)
- Claude / GPT-4: trillions (~3,500× bigger)

So your brain is small. It will **never beat Claude** on raw capability — that's a physics-of-compute problem, not a software problem. But it has things the big models don't:

- **It knows YOU specifically.** Your way of writing, your projects, your past conversations, things you care about. The big models reset every conversation.
- **It runs free, forever, on your hardware.** No API bills.
- **It's transparent.** Every decision it makes is logged. You can audit any tick.
- **It has its own persona.** "Mindees" — first-person, never says "as an AI."

The architecture is **DeepSeek-V3 class**: Multi-head Latent Attention (saves memory), Multi-Token Prediction (denser learning), SwiGLU FFN, RMSNorm, RoPE positional encoding, GQA for the KV cache. All the same tricks DeepSeek uses, scaled down for your GPU.

---

## 7. The safety + quality features

These run on every chat turn, invisibly:

- **PII guard.** Scans your messages for emails, phone numbers, credit cards, SSNs, addresses. Redacts them in the *training corpus* before that corpus ever leaves your machine for public HuggingFace. So even though the corpus is technically public, your personal info isn't in it.
- **Leak guard.** Catches "as a conversational AI" / "I rely on publicly available information" disclaimers that sometimes leak through from the cloud models' training. When detected, the reply gets rewritten with a stronger persona anchor.
- **Toxicity classifier.** Detects when *you* are angry or hostile. Mindees switches to listening register instead of escalating.
- **Topic router.** Classifies the message into code / math / personal / creative / factual / meta. Adjusts the reply's register accordingly (code → concrete examples; personal → acknowledgement first; etc.).

Plus **9 transformers.js models** running locally on the Vercel function (no API calls): embedder, reranker, emotion, sentiment, NER, toxicity, PII, topic router, summariser.

---

## 8. What you need to do (once-only setup)

### On your PC

```bash
# Clone + install
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai
npm install                     # ~500 dependencies, mostly Next.js + transformers

# For local dev only — point persistence at the local disk
cp .env.example .env.local
# edit .env.local — minimum: CRON_SECRET (openssl rand -hex 32)
# leave MEMORY_PERSISTENCE=local for dev

npm run dev                     # → http://localhost:3000
```

### On Vercel (where the public website runs)

Set these environment variables in Vercel project settings:

| Variable | Where to get it |
|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 |
| `R2_BUCKET` | Whatever you named your bucket |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API tokens |
| `R2_SECRET_ACCESS_KEY` | Same place |
| `MIND_VARIANT` | `home-11gb` (matches what you trained) |
| `GROQ_API_KEY` | https://console.groq.com (free) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | https://aistudio.google.com (free) — optional fallback |

**Do not** set `MEMORY_PERSISTENCE` — leave it unset and the auto-detector picks R2.

### On GitHub (where the weekly retrain runs)

Add these same R2 secrets PLUS `HF_TOKEN` to GitHub repo → Settings → Secrets → Actions:

- `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (same values as Vercel)
- `HF_TOKEN` (write-scoped token from huggingface.co/settings/tokens)

### On cron-job.org (the actual 15-minute heartbeat)

Create a new cron job:
- URL: `https://<your-vercel-project>.vercel.app/api/cron/self-improve?token=<your-CRON_SECRET>`
- Interval: every 15 minutes
- Method: GET

### Training your own brain (on the RTX 5070 in WSL2)

```bash
# Install Python + PyTorch CUDA + huggingface-cli (one-time)
pip install -r scripts/train/requirements.txt
huggingface-cli login  # paste your write token, cached locally

# Run the full home-11gb training with the 6-dataset broad-brain mix
bash scripts/train/run-home-max.sh \
  --variant home-11gb \
  --steps 50000 \
  --batch 4 \
  --grad-accum 2 \
  --no-compile \
  --mix-config scripts/data/mix-broadbrain.json

# ~15-20 hours overnight
# When done:
python scripts/upload_to_hf.py  # → pushes base.bin to huggingface.co/aashir-athar/mindeesai-base
```

After the upload, the next cold start on Vercel downloads the new brain automatically. Flip `USE_NATIVE_MODEL` on at `/admin` and chat — Mindees is now running on YOUR weights.

---

## 9. Where to look when something breaks

| Symptom | Where to check |
|---|---|
| Audit pages all show 0 | `/setup` page — usually `MEMORY_PERSISTENCE=local` is still set on Vercel |
| Cron never fires | cron-job.org History tab; check HTTP status code |
| Chat falls back to cloud instead of native brain | `/api/inference-mode` — `checkpoint_present` must be true |
| Vercel build fails | Build logs on Vercel; usually a TypeScript error |
| Weekly retrain workflow fails | GitHub Actions run logs |
| Training OOMs on GPU | Drop `--batch` to 2 in the run command, or add `--no-grad-ckpt` |
| Same thread ID on every device | Should be fixed — `force-dynamic` on `/chat` route |

The single best diagnostic page: **`/setup`** on your deployed Vercel app. It has color-coded checks for every layer (R2 connection, blob token, cron heartbeats, distill rows, journal entries, vector memory, etc.) and tells you the exact fix for each red row.

---

## 10. The one-line summary

> A web app where every chat trains a custom neural network that learns your voice, remembers your conversations forever via free-tier cloud storage, and gets smarter every week without anyone paying for inference — all 100% open-source, all on free hardware tiers.

That's the whole thing.
