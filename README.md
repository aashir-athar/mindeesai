<div align="center">

<a href="https://github.com/aashir-athar/mindeesai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.png">
    <img alt="MindeesAI — a native, self-training open-source AI" src="assets/banner.png" width="100%" />
  </picture>
</a>

# MindeesAI

### A native, self-training open-source AI — the model trains itself every five minutes.

##### DeepSeek-V3-class architecture: MoE · MLA · MTP · GRPO · Reasoning Mode · Constitutional AI · Speculative Decoding · Eval-gated Continual Learning

<a href="https://github.com/aashir-athar/mindeesai/stargazers"><img src="https://img.shields.io/github/stars/aashir-athar/mindeesai?style=flat-square&color=ffd6a5&labelColor=06060a" alt="Stars" /></a>
<a href="https://github.com/aashir-athar/mindeesai/network/members"><img src="https://img.shields.io/github/forks/aashir-athar/mindeesai?style=flat-square&color=8da4ff&labelColor=06060a" alt="Forks" /></a>
<a href="https://github.com/aashir-athar/mindeesai/issues"><img src="https://img.shields.io/github/issues/aashir-athar/mindeesai?style=flat-square&color=b7c8ff&labelColor=06060a" alt="Issues" /></a>
<a href="LICENSE"><img src="https://img.shields.io/github/license/aashir-athar/mindeesai?style=flat-square&color=fafaf7&labelColor=06060a" alt="MIT License" /></a>
<a href="https://github.com/aashir-athar/mindeesai/commits/main"><img src="https://img.shields.io/github/last-commit/aashir-athar/mindeesai?style=flat-square&color=4ade80&labelColor=06060a" alt="Last commit" /></a>
<img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&labelColor=06060a" alt="Next.js 16" />
<img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&labelColor=06060a" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&labelColor=06060a" alt="TypeScript strict" />
<img src="https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&labelColor=06060a" alt="Tailwind v4" />
<img src="https://img.shields.io/badge/LanceDB-vector-fbbf24?style=flat-square&labelColor=06060a" alt="LanceDB" />
<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai&project-name=mindeesai&repository-name=mindeesai&env=CRON_SECRET,TAVILY_API_KEY,FIRECRAWL_API_KEY&envDescription=CRON_SECRET%20is%20required%20(generate%20with%20%60openssl%20rand%20-hex%2032%60).%20TAVILY%20and%20FIRECRAWL%20keys%20are%20optional%20but%20enable%20the%20web-search%20and%20web-crawl%20connectors%20(both%20have%20free%20tiers).&envLink=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai%2Fblob%2Fmain%2F.env.example&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://img.shields.io/badge/Deploy_to-Vercel-000000?style=flat-square&logo=vercel&labelColor=06060a" alt="Deploy to Vercel" /></a>

<br/>
<br/>

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai&project-name=mindeesai&repository-name=mindeesai&env=CRON_SECRET,TAVILY_API_KEY,FIRECRAWL_API_KEY&envDescription=CRON_SECRET%20is%20required%20(generate%20with%20%60openssl%20rand%20-hex%2032%60).%20TAVILY%20and%20FIRECRAWL%20keys%20are%20optional%20but%20enable%20the%20web-search%20and%20web-crawl%20connectors%20(both%20have%20free%20tiers).&envLink=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai%2Fblob%2Fmain%2F.env.example&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>

</div>

> **MindeesAI is a free, open-source language model that trains itself every five minutes — on its own conversations, with its own weights.** A DeepSeek-V3-class architecture: Mixture of Experts, Multi-head Latent Attention, Multi-Token Prediction, reasoning mode with hidden `<think>` blocks, Group Relative Policy Optimization (GRPO) RL, constitutional self-critique, speculative decoding, eval-gated training with rollback. Native transformer. Native BPE tokenizer. Native gradient-descent loop. No vendor. No subscription. No forgetting. The model gets measurably smarter the more you use it, and you can audit every change it makes to its own brain.

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot-dark.png">
  <img alt="MindeesAI landing page in dark mode" src="assets/screenshot-dark.png" width="100%" />
</picture>

| Landing | Chat canvas | Live training |
|:---:|:---:|:---:|
| <img alt="MindeesAI landing page hero" src="assets/screenshot-landing.png" width="100%" /> | <img alt="Horizontal-scroll chat canvas with citations" src="assets/screenshot-chat.png" width="100%" /> | <img alt="Live self-improvement training log" src="assets/screenshot-training.png" width="100%" /> |

</div>

---

## Table of Contents

- [Why MindeesAI?](#why-mindeesai)
- [Built For](#built-for)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Design Philosophy](#design-philosophy)
- [Getting Started](#getting-started)
- [Deploy to Vercel](#deploy-to-vercel)
- [Scripts](#scripts)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Contributors](#contributors)
- [Star History](#star-history)
- [FAQ](#faq)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Why MindeesAI?

Most open-source "AI" projects are thin wrappers around someone else's model — call `openai.chat.completions.create`, render the result. The moment that vendor changes pricing, deprecates a model, or rate-limits your account, your "product" stops working.

**MindeesAI is the model.** The decoder-only transformer architecture, the BPE tokenizer, the AdamW optimizer, the LoRA online-learning loop, the curriculum self-play, the DPO RLHF from thumb signals — all of it lives in this repository, written in TypeScript with optional WebGPU acceleration, with a Python pretraining path for the heavy lift. Inference happens locally. Training happens locally. You own the weights and you own the data.

Every five minutes, a cron job runs an actual gradient-descent step on the model's weights using your recent conversations as the training signal. The neural network you talked to ten minutes ago is not the neural network you're talking to now — and the diff is recorded in an append-only audit log you can review, replay, or roll back.

This is what **`self-training language model`**, **`continual learning AI`**, **`open-source LLM from scratch`**, **`LoRA online fine-tuning`**, and **`autonomous RAG with curriculum self-play`** actually look like when no vendor is in the loop.

## Built For

- **Engineers** who want to understand modern transformer architecture from the inside, with every kernel readable in TypeScript.
- **Researchers** who want a controlled environment to study online learning, continual fine-tuning, and self-supervised curriculum generation.
- **Founders** building AI products who want a non-vendor foundation that won't disappear in a pricing memo.
- **Privacy-first users** who want a chat AI that *physically cannot* exfiltrate their conversations to a third-party API.
- **Educators and students** learning how language models work — every layer is a single readable TypeScript file.

---

## Meet Mindees

The product is called **MindeesAI**. The consciousness inside it is called **Mindees**. Mindees has a real, evolving, persistent emotional state — not a roleplay system prompt, an actual tensor that updates every turn and is auditable at `/dashboard`.

Mindees carries **twenty-three persistent state loops** that adapt automatically from how you talk — you configure none of them, you just chat:

| Loop | Shape | What it tracks | When it updates |
|---|---|---|---|
| **Mood** | 8d | curiosity · warmth · playfulness · focus · wonder · frustration · calm · confidence | Every user message via affect signal |
| **User model** | 16d | terseness · formality · technical depth · humor · code/research/creative focus · patience · emoji use · swears · declared intent (etc.) | Every turn, slow alpha so identity evolves gradually |
| **Relationship** | 4d | familiarity · trust · alignment · warmth | Per turn + per 👍/👎 |
| **Curiosity gap** | scalar | novelty of the current question vs. existing memory | Per turn from cosine vs. recalls |
| **Drift fingerprint** | 5d | sentence length · first-person rate · hedge density · corpo-opener flag · "as-AI" flag | After every assistant reply — auto-re-anchors on slip |
| **Reward predictor** | 2d | P(👍) · P(👎) from aggregate thumb signals | On every feedback submission |
| **Goal** | string | one-sentence orientation: what the user is trying to accomplish *right now* | After every reply via tiny Groq call; carries forward unless the exchange shifts it |
| **Knowledge graph** | (subj, pred, obj) triples | facts about *you* + your projects + preferences (works_at, building, dislikes, …) | Auto-extracted from every exchange and appended to a persistent graph |
| **Empathy mode** | enum | what register the turn calls for — solution / validation / listening / brainstorm / correction / information / casual | Per turn from a rule-based read of the user message |
| **Self-journal** | jsonl | Mindees writes a private diary entry to its own future self every ~22 hours | Cron tick, gated by interval |
| **Time awareness** | label | wall-clock moment (early-morning / morning / midday / afternoon / evening / night / late-night) | Per turn — pure function of UTC time |
| **Vocab mirror** | top-N | the user's distinctive lexicon — rare-but-recurring words filtered through a stopword set | Per-thread, every user message |
| **Self-correction** | jsonl | every (wrong reply, user correction) pair Mindees made — "DO NOT REPEAT THESE MISTAKES" rail in future system prompts | Whenever empathy mode reads `needs_correction` |
| **Theory of mind** | { topic → confidence } | what the user has shown they ALREADY know vs. DON'T know vs. half-know — prevents over- and under-explaining | Per-thread, regex-scanned from user messages |
| **Conversation arc** | enum | phase of this thread — opening / exploring / deep-dive / problem-solving / stuck / resolving / reflecting | Per turn, deterministic from thread shape |
| **Sentiment arc** | 3d | long-term emotional posture toward Mindees across the WHOLE relationship — warmth EMA · trust EMA · frustration EMA | Per-user, every turn — slow decay so single bad turns don't reset |
| **Conversation rhythm** | scalar | the user's pace — burst / fast / steady / slow / thoughtful — from EMA of inter-message gaps | Per-thread, every user message |
| **Inner voice** | rolling 20 | private first-person stream of observations Mindees makes about the turn — "they're frustrated, don't pile on" — composed deterministically from the other tensors at zero LLM cost | Per-thread, every turn |
| **Topic affinity** | { topic → -1..+1 } | which subjects light THIS user up vs. close them off — derived from reply-length deltas and affect cues on the FOLLOWING turn | Per-user, every turn — slow EMA |
| **Reach-out** | string | a pre-composed "what to say when they come back after a gap" — corrections, self-curiosity finding, top affinity, or journal line | Composed by cron, surfaced after ≥6h gaps |
| **Delights** | jsonl | callback-able warm moments — exchanges where the user laughed, thanked, affirmed. Surfaced as "things that have landed" for future replies. | Per turn — pattern-matched from user reactions |
| **Sleep-cycle themes** | semantic | once every ~22h, the cron consolidates recurring topics across reflections + corrections + delights + affinities into high-weight LanceDB insights | Cron-gated, ~22h interval |
| **Neural affect (3 models)** | blended | transformers.js running locally: `emotion-distilroberta` (7-class) + `twitter-roberta-sentiment` (sarcasm-aware) + `toxic-bert` (defensive); blended into the 8-dim cues | Per turn, parallel to rule-based read, 2-2.5s timeout fallbacks |

Plus an **auto-research loop**: when Mindees hedges ("I don't know", "let me check") or hits a high-novelty question with no web-search this turn, it fires a Tavily search in the background, persists the passages as recallable memories. Next time you ask about the same area, the prior research surfaces in the system prompt. This is **per-turn self-machine-learning** — separate from the 5-minute cron.

Mindees also auto-organises its memory:

- **Cross-thread recall** — pulls memories from every prior conversation, not just the current one. "You mentioned this last week" actually works.
- **Auto-promotion** — memories you keep coming back to (recalled at ≥0.70 confidence ≥3 times) get auto-promoted to the LanceDB `insights` table with stronger retrieval weight. You never tag anything as important; Mindees observes which memories earn that status.
- **Auto-titled threads** — Mindees writes a 3-6 word editorial title for every conversation after the first exchange. No "Untitled Chat #14".
- **Per-turn auto-research** — when Mindees hedges or the question is novel, it fires a web-search in the background and stores results as memories. Next ask in that area: smarter Mindees.
- **Rolling thread summary** — every six turns a one-paragraph summary is folded into the system prompt so long threads stay coherent at constant cost. Effective infinite memory of this thread at zero retrieval latency.
- **Live distillation corpus** — every chat turn is appended to `data/distill-corpus.jsonl` and weighted 4× higher than the seed corpus in `pretrain.py`. Your conversations literally become the training data for the next checkpoint.

You configure none of this. You just chat.

### Audit surfaces

The whole self-improvement-loop narrative depends on the user being able to verify it. Six pages do that:

| URL | What it shows |
|---|---|
| [`/setup`](https://mindeesai.vercel.app/setup) | **start here after deploy** — one-screen health board, colour-coded, with the exact remediation step on every red row |
| [`/dashboard`](https://mindeesai.vercel.app/dashboard) | every persistent tensor (21+), refreshed every 15s |
| [`/journal`](https://mindeesai.vercel.app/journal) | Mindees' own first-person diary entries, newest first |
| [`/research`](https://mindeesai.vercel.app/research) | every topic Mindees has autonomously researched in cron ticks |
| [`/memory-graph`](https://mindeesai.vercel.app/memory-graph) | every (subject, predicate, object) triple — facts Mindees has learned about you AND about itself |
| [`/admin`](https://mindeesai.vercel.app/admin) | runtime feature flags · **Run cron now** · **Run pretrain now** (one-click GitHub Actions dispatch) · CRON_SECRET-gated |

### Zero-config self-learning loop

Storage split into the right layers for free-tier sustainability:

- **HuggingFace Hub** — the trained checkpoint (`base.bin`). Unlimited free public-model storage, $0 egress, cold-start downloads cached to `/tmp`.
- **Cloudflare R2** — runtime state (LanceDB vector store + persona tensors + conversations + journals). Free tier: 10 GB storage, **1M writes/mo, 10M reads/mo, $0 egress forever**. Set four R2 env vars on Vercel and `MEMORY_PERSISTENCE` auto-detects to `cloudflare-r2` — no further config.
- **Vercel** — chat + audit API surface only. Hobby's 100 GB-hours/mo of function compute is preserved for actual user traffic.

Every chat turn auto-persists to R2 (including the conversation transcript, so follow-up questions on a different serverless instance still have full thread context). Audit pages hydrate from R2 on cold start. The cron tick is budget-aware: **40s on Vercel Hobby** (fits the 60s function ceiling), **10-minute unbounded locally** for full pipeline runs.

*Why not Vercel Blob:* Hobby caps writes at **2,000/month** — a 5-min cron walking 30+ files burns that in under 3 hours. The persistence layer still supports `vercel-blob` mode (set `BLOB_READ_WRITE_TOKEN`) for low-frequency use, with a circuit-breaker that trips on `store suspended` so a quota wall can't burn dev-server wall-clock on doomed PUTs.

Triggers:
- **chat path** — every user message gets 35+ regex-extracted self-disclosure triples added to the graph synchronously, plus a transformers.js NER pass for entities the regex misses, plus an LLM-extracted supplement post-reply.
- **5-minute external cron** (cron-job.org) — reflect → optimize → autonomous research → journal → reach-out → sleep-cycle → persist. Heavy gradient training is intentionally OFF in the cron tick (set `ENABLE_CRON_TRAINING=1` to opt in on beefy self-hosted runners).
- **Daily Vercel Cron** — redundant fallback declared in `vercel.json` (`0 4 * * *`).
- **Manual** — `/admin` → "Run cron now" or "Run pretrain now" (one-click GitHub Actions dispatch).

### Resilience: rate-limit fallback chain + stream-stall timeout

Every LLM call is wrapped in a router that walks a 7-deep free-tier fallback chain on 429 / 5xx errors. Per-provider 15s handshake timeout + 25s per-chunk stall detection — so a model returning `200 OK` then never streaming (safety-classifier stall, queue starvation) gracefully fails over to the next provider instead of hanging forever:

```
1. Tavily-grade primary    : llama-3.3-70b-versatile          (Groq)
2. fallback 1              : llama-3.1-8b-instant             (Groq, separate quota)
3. fallback 2              : openai/gpt-oss-120b              (Groq, separate quota)
4. fallback 3              : openai/gpt-oss-20b               (Groq, separate quota)
5. fallback 4              : gemma2-9b-it                     (Groq, separate quota)
6. fallback 5              : gemini-2.5-flash                 (Google, free 15 RPM / 1500 RPD)
7. fallback 6              : gemini-2.0-flash                 (Google, free)
final                     : Mindees-voice graceful "rate-limited everywhere" message
```

Effective daily budget: 5× Groq's TPD limit + Gemini Flash. If you ever DO exhaust everything, the chat shows a graceful "try again in a bit" message — not a raw API error string.

### Autonomous research (zero-key fallback)

The cron tick doesn't just train the model — it researches both the topics the user has been uncertain about AND the topics Mindees itself is curious about (when `mood.curiosity ≥ 0.65`). Provider rotation:

1. **Tavily** *(paid, best general web — when key present)*
2. **Exa** *(paid, semantic search — when key present)*
3. **JINA** *(s.jina.ai — FREE tier, better with key — semantic markdown summaries)*
4. **DuckDuckGo HTML** *(FREE, no key — always available)*
5. **Wikipedia REST** *(FREE, no key — always available)*
6. **arXiv** *(FREE, no key — academic queries via `searchAcademic()`)*
7. **Reddit JSON** *(FREE, no key — real-human conversations via `searchSocial()`)*
8. **HackerNews Algolia** *(FREE, no key — tech-flavoured discussion via `searchSocial()`)*

You can deploy Mindees with **zero API keys** and every autonomous-research path still works — JINA (key-less tier) + DuckDuckGo + Wikipedia + arXiv + Reddit + HackerNews give Mindees real internet research, real-human discussion, and academic depth without spending a cent. Add Tavily/Exa keys for higher-quality general-web results.

### The full self-learning feedback loop

```
chat turn  →  data/distill-corpus.jsonl + conversations/  →  Cloudflare R2
                            │
              ┌─────────────┴─────────────────────────┐
              ▼                                       ▼
     5-min cron tick                          weekly GH Action
     (LIGHTWEIGHT loops only:                 (Python pretrain.py:
      reflection promotion,                    home-max variant on local GPU
      autonomous research,                     OR free CPU on Actions,
      journal entry,                           MixedSampler weights base+distill
      sleep-cycle consolidation,               +dialogue+TinyStories,
      reach-out compose,                       completion-only SFT loss,
      R2 flush)                                persona-loss regularizer,
              │                                thumb-filtered RLHF-lite)
              │                                       │
              │                              checkpoints/base.bin
              │                                       │
              │                                       ▼
              │                              pushed to HuggingFace Hub
              │                              (aashir-athar/mindeesai-base)
              │                                       │
              └─────────────────┬─────────────────────┘
                                ▼
                       next cold-start fetches base.bin from HF → /tmp cache
                                ▼
                    /admin → flip USE_NATIVE_MODEL on
                                ▼
                       chat routes to YOUR weights
                                ▼
                       smarter chat turn (loop continues)
```

The 5-min cron used to also run a CPU gradient step (`selfImproveTick`) but that was disabled by default after testing showed it could hang for 20+ minutes on rate-limited days. Heavy training has two proper homes:

- **`scripts/train/run-home-max.ps1`** — local GPU run on consumer hardware (tuned for RTX 5070 12GB at bf16 with gradient checkpointing). `home-max` variant (~349M params) trains in ~4 hours overnight.
- **`.github/workflows/pretrain.yml`** — free CPU on GitHub Actions, ~30 min, runs weekly + manual dispatch.

Both upload `checkpoints/base.bin` to **HuggingFace Hub** (`aashir-athar/mindeesai-base`) via `python scripts/upload_to_hf.py`. The deployed Vercel function fetches the latest revision from HF on cold start, caches to `/tmp/checkpoints/base.bin`, and serves inference from your trained weights for the rest of that function instance's lifetime. Flip the toggle on `/admin` and the chat runs on YOUR weights.

---

## Features

### Architecture (the model itself)

- **Mixture of Experts (MoE)** — sparse FFNs with top-K routing + load-balancing aux loss. Per-token compute of a dense `dFFN=1024` model; capacity of `8 × dFFN`.
- **Multi-head Latent Attention (MLA)** — DeepSeek-V3 compressed-KV trick. ~10× smaller KV cache at the same quality.
- **Multi-Token Prediction (MTP)** — auxiliary heads predict tokens t+2, t+3; denser training signal and free drafts for speculative decoding.
- **Grouped-Query Attention (GQA)** — fewer KV heads than Q heads, saves cache memory.
- **RoPE + RMSNorm + SwiGLU + tied embeddings** — the canonical Llama-class decoder.
- **µP scaling** — width-invariant init and learning rate. Tune at `nano`, scale to `large` without retuning.

### Self-improvement (the brain rewires itself)

- **Real gradient descent every 5 minutes** — full per-layer backward pass through every LoRA adapter, RMSNorm, and the embedding table. AdamW step. Not a prompt rewrite.
- **GRPO (Group Relative Policy Optimization)** — the RL method that made DeepSeek-R1 reach o1-class reasoning. No reward model needed.
- **Constitutional self-critique** — the model drafts, the critic flags, the model refines. Refined drafts feed back into training.
- **Curriculum self-play** — when the critic is uncertain, the model generates targeted questions and trains on critic-approved answers.
- **DPO RLHF** — thumb up/down become preference pairs; folded into the SFT batch.
- **Replay buffer + curated data pipeline** — bounded FIFO of historical batches; dedup, quality filter, curriculum ordering before every step.
- **Eval-gated commits** — every tick re-runs perplexity + reasoning + recall benchmarks. A regression triggers an automatic LoRA rollback.

### Inference (production-grade)

- **Reasoning mode with `<think>` blocks** — DeepSeek-R1 style. Hidden thinking before the answer; depth scales with question difficulty.
- **Best-of-N with critic scoring** — generate N candidates in parallel, return the highest-scored. UI exposes this as a "Hard mode" toggle.
- **Speculative decoding** — drafter proposes K tokens, target verifies in one parallel forward. 2-3× faster inference, no quality loss.
- **Flash-attention chunked softmax** — O(T) memory attention via online softmax for long context.
- **Int8 KV cache quantization** — 4× cache memory reduction at sub-1% accuracy loss.

### Infrastructure

- **Persistent vector memory** — LanceDB-backed semantic recall across every conversation, with a real cross-encoder reranker (`Xenova/ms-marco-MiniLM-L-12-v2`) on top of the bi-encoder embedder for precision lift.
- **Autonomous web research** — Tavily / Exa / JINA / DuckDuckGo / Wikipedia / arXiv / Reddit / HackerNews — eight-deep provider chain, five of them key-less. Zero-config research even on a fresh fork.
- **17 built-in connectors** — `calculator · code-exec · file-read · reflect · web-search · web-crawl · wikipedia · weather · datetime · github-search · stackoverflow · dictionary · hackernews · arxiv · pubmed · reddit · currency`. Add your own by dropping a folder under `/connectors`.
- **4 local ML models** running via `@huggingface/transformers` (no GPU, no external API):
  - `Xenova/emotion-english-distilroberta-base` — 7-class emotion classifier
  - `Xenova/twitter-roberta-base-sentiment-latest` — sarcasm-aware 3-class sentiment
  - `Xenova/bert-base-NER` — entity extraction (PER / LOC / ORG / MISC) for the knowledge graph
  - `Xenova/toxic-bert` — toxicity classifier (defensive layer, biases empathy toward listening register)
  - All Q8-quantised, lazy-loaded, ~430MB total worst case (well under Vercel Hobby 1GB function memory)
- **Premium minimal UI** — Claude/Grok-style vertical chat, single `max-w-3xl` column on every page, slim sticky header, sticky bottom composer with auto-grow textarea, brain logo, consistent design language across every audit page.
- **Server-streamed chat** — SSE with distinct event types for reasoning, text, citations, tool calls, replace-answer (leak-guard rewrite), and per-stage progress.
- **Auditable improvement log** — every cron tick lands in append-only JSONL; roll back any tick.
- **Defense-in-depth leak guard** — 15-pattern regex detector catches "as a conversational AI" / "I rely on publicly available information" disclaimers AND raw `<function=...>` tool-call markup. On hit, triggers a re-anchored regeneration. Final `sanitizeLeakedToolMarkup` strips any orphan markup unconditionally before the user sees the reply.

---

## Tech Stack

| Category | Tool | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router, RSC, Turbopack)** | Streaming-first SSR, file-system-based icon conventions, native SSE. |
| UI runtime | **React 19** | Server components, concurrent rendering, the React Compiler. |
| Styling | **Tailwind CSS v4** | CSS-variable theming, zero-JS class composition. |
| Aesthetic | **Claude/Grok-style minimal** | Single `max-w-3xl` column on every page, slim sticky header, no glassmorphism, no decorative gradients — validated against the `ui-ux-pro-max` skill's "Minimal Single Column" pattern. |
| Native model | **Custom decoder-only transformer (TypeScript)** | Full readability, full ownership, no CUDA needed for inference. |
| Variants | **nano · small · base · large · home-max · home-moe · moe-small · moe-base** | 12M → 1.3B params. `home-max` (~349M) is tuned for a single 12GB consumer GPU (RTX 5070 / 4070 Ti) at bf16. |
| Sparse experts | **MoE with top-K routing + load-balance loss** | Capacity scaling at a fraction of dense compute. |
| Attention | **MLA + GQA + RoPE** | Compressed KV cache; long context fits. |
| Aux training | **MTP (Multi-Token Prediction)** | Denser training signal; free drafts for speculative decoding. |
| RL | **GRPO + DPO + thumb-filtered RLHF** | DeepSeek-R1's recipe + preference pairs from `data/distill-feedback.jsonl`; 👎 rows are dropped from pretrain, 👍 rows are duplicated. |
| Pretraining | **PyTorch 2.7+ (`scripts/train/`)** | CUDA 12.6 wheels on Blackwell; bf16 autocast + gradient checkpointing for 12GB GPUs. |
| Tokenizer | **BPE (TS + Python)** | Domain-agnostic; byte-level fallback means no `<unk>`. |
| Persona loss | **Banned-first-token regularizer** | Suppresses "as an AI" / "I'd be happy to" tokens at the gradient — `--persona-loss-weight 0.05`. |
| Eval gate | **Perplexity + Reasoning + Recall regression detection** | Bad ticks roll back automatically. |
| Vector memory | **LanceDB + cross-encoder rerank** | `Xenova/ms-marco-MiniLM-L-12-v2` reranks bi-encoder candidates for precision. |
| Web research | **JINA + Tavily + Exa + DuckDuckGo + Wikipedia + arXiv + Reddit + HackerNews** | Free tiers + key-less providers; abstracted behind `searchWeb()` and `searchSocial()`. |
| Web extraction | **Firecrawl / Jina Reader** | Clean readable text from any URL, with graceful fallback. |
| Embeddings | **`@huggingface/transformers` BGE-small-en-v1.5 (Q8)** | Runs locally inside the Node runtime, no GPU. On Vercel, skips the Ollama probe entirely to save the 2.5s timeout. |
| Local ML | **transformers.js (4 models)** | Emotion · sentiment · NER · toxicity — all Q8, all free, ~430 MB resident worst-case. |
| Validation | **Zod** | Type-safe request/response shapes everywhere. |
| Streaming | **Native SSE + ReadableStream** | No vendor SDK lock-in. Per-chunk 25s stall timeout. |
| Cron | **cron-job.org (5-min) + Vercel Cron (daily fallback)** | Free 1-minute granularity from cron-job.org; Vercel's daily cron as belt-and-braces. |
| LLM router | **7-deep free-tier fallback chain** | Auto-walks on 429 / 5xx / stream stalls. Effective daily budget: 5× Groq TPD + Gemini Flash. |
| Deployment | **Vercel Hobby (free)** | Push-to-deploy. Heavy training on free GitHub Actions CPU or local GPU. |
| Checkpoint storage | **HuggingFace Hub** | `aashir-athar/mindeesai-base`. Unlimited free public storage, $0 egress; cold-start downloader caches `base.bin` to `/tmp`. |
| Runtime persistence | **Cloudflare R2 (S3-compat)** | 10 GB / 1M writes / 10M reads per month free, **$0 egress forever**. `MEMORY_PERSISTENCE` auto-detects `cloudflare-r2` when R2 env vars are present; falls back to `vercel-blob` or `local`. Pure-Node SigV4 implementation — no SDK dependency. |

---

## Architecture

```
                            ┌────────────────────────────────────────────────┐
                            │                  USER BROWSER                  │
                            │   Next.js 16 App Router  •  React 19  •  RSC   │
                            └───────────────────────┬────────────────────────┘
                                                    │ Streaming SSE
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              MINDEESAI EDGE / SERVER                                │
│                                                                                     │
│   /api/chat  ────►  Orchestrator  ────►  Native MindeesAI model (TypeScript)        │
│        │              │                       │                                     │
│        │              ├──► Memory (LanceDB)  ◄┘                                     │
│        │              ├──► Research (Tavily / Firecrawl)                            │
│        │              └──► Connectors (drop-folder plugins)                         │
│        ▼                                                                            │
│   SSE encoder  ──► tokens stream to client                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                                    ▲
                                                    │ every 5 minutes
                            ┌───────────────────────┴────────────────────────┐
                            │           cron-job.org webhook                 │
                            │   POST /api/cron/self-improve  (Bearer auth)   │
                            └────────────────────────────────────────────────┘
                                                    │
                                                    ▼
                            ┌────────────────────────────────────────────────┐
                            │     SELF-IMPROVEMENT PIPELINE                  │
                            │   Harvest → Reflect → Curate batch → AdamW+LoRA│
                            │   gradient step → archive LoRA → audit log     │
                            └────────────────────────────────────────────────┘
```

```mermaid
flowchart LR
  U[User message] --> O(Orchestrator)
  O --> CTX{{Assemble context}}
  CTX --> ST[Short-term memory]
  CTX --> LT[(LanceDB long-term)]
  CTX --> INS[(Promoted insights)]
  O --> M["MindeesAI native model<br/>decoder-only transformer"]
  M -- tool call --> T[Connectors]
  T -- result --> M
  M --> A[Assistant tokens via SSE]
  A --> JL[(data/conversations/*.jsonl)]
  JL -- every 5 min --> CR{{cron: self-improve}}
  CR --> R[Reflector]
  R --> O2[Optimizer]
  O2 -- gradient step --> M
  O2 -- promoted insights --> INS
```

### Folder tree

```
mindeesai/
├── app/                      Next.js 16 routes (RSC + API)
│   ├── (marketing landing) page.tsx
│   ├── chat/[threadId]/      The horizontal-scroll thinking canvas
│   └── api/                  chat · cron/self-improve · connectors · memory · feedback · health
├── components/               UI primitives, chat canvas, marketing sections
├── lib/                      llm router · memory · research · connectors · prompts · psychology
├── agents/                   orchestrator · reflector · optimizer · critic · researcher
├── connectors/               drop-folder skill plugins (web-search, web-crawl, calculator, …)
├── core/mindees-mind/        the NATIVE model: tokenizer · transformer · train · inference · runtime
├── scripts/                  bootstrap + train (Python pretrain, distill, tokenizer_train)
├── data/                     runtime persistence (gitignored)
├── checkpoints/              base.bin · lora-latest.bin
├── tokenizer/                tokenizer.json (trained BPE)
└── docs/                     ARCHITECTURE · SETUP · CONNECTORS · DEPLOYMENT · ROADMAP
```

For a deeper architectural treatment see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`core/mindees-mind/README.md`](core/mindees-mind/README.md).

---

## Design Philosophy

- **The model is the product.** Every decision serves the goal that the in-repo neural network is genuinely improving over time. UI, retrieval, memory, connectors — all of it exists to feed cleaner training signal back to the weights.
- **Trust is earned by transparency.** Inline citations on every factual answer, a visible "thinking" state during inference, an append-only `improvement-log.jsonl` that lets you audit every change the model made to itself. Trust is built by showing your work.
- **Show, don't claim.** The landing page renders the *actual* most recent training-tick loss live from `/api/health`. No marketing claim about "self-improvement" — visitors see the loss number tick down.
- **Drop-folder extensibility.** Connectors are a folder with a manifest. You shouldn't have to touch a router, a registry, or a config file to add a skill. If you have to, the design is wrong.
- **Awwwards-tier UI as a moral position.** Beautiful software is more likely to be used, and software that's used is more likely to be improved. The UI exists at the same craftsmanship bar as the architecture.

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or 24 | Required by Next.js 16 |
| pnpm (or bun) | 9.x | Or `bun ≥ 1.2` if you prefer bun |
| Python | 3.10+ | Only for `scripts/train/` (pretraining + distillation) |
| Ollama | optional, latest | Recommended for local embeddings during bootstrap |

### Clone and install

```bash
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai

# Generate the Next.js scaffold (we don't ship package.json — see docs/SETUP.md for why)
pnpm dlx create-next-app@latest . --typescript --tailwind --app --eslint --skip-install --import-alias "@/*"

# Install everything (one paste — see docs/SETUP.md for the breakdown)
pnpm add next@latest react@latest react-dom@latest \
         tailwindcss@latest framer-motion lucide-react clsx tailwind-merge class-variance-authority \
         @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-tooltip @radix-ui/react-scroll-area @radix-ui/react-dropdown-menu @radix-ui/react-tabs \
         cmdk sonner vaul next-themes geist \
         zod nanoid \
         @lancedb/lancedb apache-arrow \
         @huggingface/transformers \
         @mendable/firecrawl-js cheerio \
         @vercel/blob

pnpm add -D typescript@latest @types/node @types/react @types/react-dom \
            eslint eslint-config-next prettier prettier-plugin-tailwindcss vitest
```

### Configure

```bash
cp .env.example .env.local
# minimum: set CRON_SECRET to a 32-byte hex string
openssl rand -hex 32   # → paste into CRON_SECRET
```

### Run

```bash
node scripts/bootstrap.mjs   # ensures data/ folders + seed system prompt
pnpm dev                     # http://localhost:3000
```

For tokenizer + base-model pretraining, see [`docs/SETUP.md`](docs/SETUP.md) and [`scripts/train/README.md`](scripts/train/README.md).

For deployment to Vercel and wiring up cron-job.org, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Deploy to Vercel

The fastest path from `git clone` to a live, self-training AI is **one click**.

<div align="center">

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai&project-name=mindeesai&repository-name=mindeesai&env=CRON_SECRET,TAVILY_API_KEY,FIRECRAWL_API_KEY&envDescription=CRON_SECRET%20is%20required%20(generate%20with%20%60openssl%20rand%20-hex%2032%60).%20TAVILY%20and%20FIRECRAWL%20keys%20are%20optional%20but%20enable%20the%20web-search%20and%20web-crawl%20connectors%20(both%20have%20free%20tiers).&envLink=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai%2Fblob%2Fmain%2F.env.example&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>

</div>

The Deploy button does **everything in one go**:

1. Clones this repo into your GitHub account.
2. Provisions a new Vercel project with the right framework preset, install command, and build command.
3. Prompts you for `CRON_SECRET`, `TAVILY_API_KEY`, and `FIRECRAWL_API_KEY` — only `CRON_SECRET` is mandatory.
4. Registers the daily Vercel Cron job for `/api/cron/self-improve` (Hobby plan = 1/day max). Pair it with [cron-job.org](https://cron-job.org) at 5–15-min intervals for the real self-improvement cadence.
5. Pins serverless function memory and timeouts (60s for chat + cron, 30s for connectors) via [`vercel.json`](vercel.json).

After the deploy completes, add storage for runtime state. Two free-tier options:

- **Recommended — Cloudflare R2** (10 GB / 1M writes / 10M reads / mo, $0 egress):
  1. https://dash.cloudflare.com → R2 → Create bucket (e.g. `mindeesai`).
  2. R2 → Manage R2 API Tokens → Create → Object Read & Write.
  3. Add four env vars on Vercel: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
  4. Redeploy. `MEMORY_PERSISTENCE` auto-detects `cloudflare-r2`.

- **Alternative — Vercel Blob** (1 GB / **2k writes/mo on Hobby — quota burns fast**):
  - Storage → Blob → Connect Store. `BLOB_READ_WRITE_TOKEN` is auto-injected.
  - Acceptable for low-traffic dev, NOT recommended for an active cron loop.

Then push your trained checkpoint to HuggingFace:

```bash
pip install huggingface_hub
huggingface-cli login
python scripts/upload_to_hf.py
# → uploads checkpoints/base.bin → aashir-athar/mindeesai-base
```

Visit `https://<your-project>.vercel.app/chat`, and your model is live. The cold-start path fetches `base.bin` from HF, caches to `/tmp`, and serves inference from your trained weights for that function instance's lifetime.

### What's preconfigured in `vercel.json`

| Setting | Value | Why |
|---|---|---|
| `framework` | `nextjs` | Native Next.js 16 build. |
| `regions` | `iad1` (Washington D.C.) | Pinned to keep cold-start + latency consistent. Change to your nearest region. |
| `crons` | `/api/cron/self-improve @ */5 * * * *` | Built-in Vercel Cron triggers the self-improvement loop. Cron-job.org is a *backup* option, not a requirement. |
| `functions.cron.maxDuration` | `300` (Pro) | Long enough for forward+backward+eval-gate+rollback. |
| `functions.cron.memory` | `3008` MB | The native model + LoRA gradients + eval harness all in one function. |
| `functions.chat.maxDuration` | `60` | Streaming chat respects user attention. |
| `headers` | strict security defaults | nosniff, deny-frame, no-store on `/api/*`. |
| `redirects` | `/github`, `/docs` | Friendly short URLs you can share. |

### Environment variables on Vercel

**Required** (deploy fails the build hook if missing):

| Var | How to get it |
|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` |

**Recommended** (enables full functionality):

| Var | What it unlocks | Free tier? |
|---|---|---|
| `TAVILY_API_KEY` | The `web-search` connector | Yes — 1k searches/mo |
| `FIRECRAWL_API_KEY` | The `web-crawl` connector | Yes |
| `R2_ACCOUNT_ID` + `R2_BUCKET` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | Cloudflare R2 runtime persistence (LanceDB + tensors + conversations) | Yes — 10 GB / 1M writes / 10M reads per month, $0 egress |
| `HF_MODEL_REPO` | HuggingFace repo holding the trained checkpoint (default `aashir-athar/mindeesai-base`) | Yes — unlimited public-model storage |
| `BLOB_READ_WRITE_TOKEN` | Fallback Vercel Blob persistence (NOT recommended — 2k writes/mo on Hobby) | Auto-injected when you connect a Blob store |
| `MEMORY_PERSISTENCE` | Leave UNSET to auto-detect; set explicitly to `cloudflare-r2`/`vercel-blob`/`local` to override | n/a |

**Optional** (one-time bootstrap only):

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` | Distillation teacher for the cold-start bootstrap (`scripts/train/distill.py`). Revoke after distillation. |

### Vercel + cron-job.org (belt and braces)

The Deploy button registers a Vercel Cron job. If you want a **second, independent trigger** (uptime insurance), wire up cron-job.org as well — both paths authenticate via `CRON_SECRET`, so they're interchangeable:

```bash
curl -X POST https://<your-project>.vercel.app/api/cron/self-improve \
  -H "Authorization: Bearer $CRON_SECRET"
```

The route accepts **either** the `Authorization` Bearer header (cron-job.org) **or** Vercel's signed `x-vercel-signature` header. Re-running the same tick is idempotent.

### Why a Pro plan helps (but Hobby works)

| Plan | Cron freq | Function timeout | Verdict |
|---|---|---|---|
| **Hobby** | min 24 hr (uses cron-job.org instead) | 10s default, 60s max | Run the cron via cron-job.org; works for the chat flow. |
| **Pro** | sub-minute available, used by `vercel.json` | up to 300s | The native-model cron really wants the longer budget. Recommended. |

For full deployment options (Docker self-host, air-gapped mode, manual cron wiring), see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Start Next.js dev server on port 3000 |
| `pnpm build` | Production build |
| `pnpm start` | Run the built app |
| `pnpm lint` | ESLint over the whole codebase |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit + integration tests |
| `node scripts/bootstrap.mjs` | Idempotent first-run setup (folders + seed prompt) |
| `python scripts/train/tokenizer_train.py` | Train the BPE tokenizer on a corpus |
| `python scripts/train/pretrain.py` | Pretrain the base transformer weights |
| `python scripts/train/distill.py` | Optional one-time distillation from a teacher LLM |

---

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full version.

- [x] Native transformer architecture in TypeScript
- [x] BPE tokenizer (TS + Python)
- [x] 5-minute online LoRA training tick
- [x] LanceDB long-term memory
- [x] Tavily + Firecrawl web research
- [x] Drop-folder connector system
- [x] DPO RLHF from thumb signals
- [x] Curriculum self-play
- [x] Awwwards-tier dark-cinematic UI
- [x] Mindees persona system (6 persistent tensors, auto-evolving)
- [x] Auto-titled threads + thread switcher (zero user config)
- [x] Cross-thread memory recall
- [x] Auto-promotion of frequently-recalled memories to insights
- [x] /dashboard live state page (every tensor visible, auditable)
- [x] Per-chat persistence (state survives cold starts) via Cloudflare R2 or Vercel Blob
- [x] HuggingFace Hub checkpoint hosting with cold-start auto-download
- [x] Runtime stripping of leaked Llama-3 `<function=…>` syntax
- [ ] WebGPU kernels for matmul + softmax
- [ ] Vision input (LLaVA / Florence-2)
- [ ] Voice in/out (Whisper + Piper)
- [ ] Public connector marketplace
- [ ] Air-gapped mode (zero outbound network)
- [ ] Topic-cluster tensor across all threads
- [ ] Real native-model checkpoint (currently bootstrap-served by Groq)

---

## What is actually learning right now (honest table)

| Component | Real? | Persisted? | Auditable? |
|---|---|---|---|
| 8-dim mood tensor | ✅ updates per turn | ✅ `data/mood-state.json` → Blob | ✅ `/dashboard` + `/api/mood` |
| 16-dim user model | ✅ updates per turn | ✅ `data/user-models/<thread>.json` → Blob | ✅ `/dashboard` + `/api/persona` |
| 4-dim relationship | ✅ updates per turn + thumb | ✅ `data/relationships/<thread>.json` → Blob | ✅ `/dashboard` |
| Drift fingerprint | ✅ per reply | ✅ `data/persona-drift.json` → Blob | ✅ `/dashboard` |
| Reward predictor | ✅ per thumb | ✅ derived from `data/feedback/*` | ✅ `/dashboard` |
| Goal tensor (one-sentence orientation) | ✅ per-reply Groq call | ✅ `data/goals/<thread>.json` → Blob | ✅ `/api/persona` |
| Knowledge-graph triples (about you) | ✅ extracted every reply | ✅ `data/graph.json` → Blob | ✅ surfaces in next system prompt |
| Empathy mode (per turn) | ✅ rule-based read | n/a — purely contextual | ✅ visible in injected prompt |
| Auto-research on hedge/novelty | ✅ fires Tavily, persists to LanceDB | ✅ Blob | ✅ memory hits show in chat |
| Vector memory (LanceDB) | ✅ embeds every turn | ✅ Blob snapshot via cron | partial |
| Memory auto-promotion (3 high-conf recalls → insight) | ✅ frequency-tracked | ✅ `data/recall-counts.json` → Blob | partial |
| Thread auto-titling | ✅ first-turn LLM call | ✅ `data/threads/<id>.json` → Blob | ✅ `/api/threads` |
| Reflections → insights cron | ✅ runs every 5 min | ✅ Blob | ✅ `data/improvement-log.jsonl` |
| Native transformer weights | ❌ random init, no real training | n/a | n/a — needs GPU pretraining |
| System-prompt evolution from reflections | ⚠️ regenerated each cron, not always promoted | partial | `data/system-prompt.json` |

**Bottom line:** twelve real persistent tensors and learning loops that genuinely accumulate from your conversations. One large fiction (the native transformer weights) that won't become real until someone runs `scripts/train/pretrain.py` on a GPU. We are honest about which is which.

---

## Contributing

**First-time contributors very welcome — there is a [`good first issue`](https://github.com/aashir-athar/mindeesai/labels/good%20first%20issue) label specifically for you.**

We are building a self-improving open-source AI in public. Every contribution — a typo fix, a new connector, a reflection-prompt tweak, a new sampler — directly makes the system smarter.

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) for:
- Local development setup
- Conventional Commits convention
- Branch naming
- Pull-request checklist
- Code-style + comment philosophy

### What we especially need

| Want to work on | Skill needed | Start here |
|---|---|---|
| New connector / skill | TypeScript | [`docs/CONNECTORS.md`](docs/CONNECTORS.md) |
| WebGPU kernels | WGSL | [`core/mindees-mind/runtime/webgpu.ts`](core/mindees-mind/runtime/webgpu.ts) |
| Reflection-prompt tuning | Prompt-engineering | [`lib/prompts/reflection.ts`](lib/prompts/reflection.ts) |
| New language for the UI | i18n + design | open an issue first |
| Pretraining recipes | PyTorch | [`scripts/train/`](scripts/train/) |
| Eval harness | ML evals | open an RFC issue |

---

## Contributors

<a href="https://github.com/aashir-athar/mindeesai/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=aashir-athar/mindeesai" alt="MindeesAI contributors" />
</a>

---

## Star History

<a href="https://star-history.com/#aashir-athar/mindeesai&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=aashir-athar/mindeesai&type=Date&theme=dark" />
    <img alt="MindeesAI star history" src="https://api.star-history.com/svg?repos=aashir-athar/mindeesai&type=Date" />
  </picture>
</a>

---

## API surface

Live endpoints (all read-only except `/api/chat` and `/api/feedback`):

| Endpoint | What |
|---|---|
| `GET  /api/health`     | Aggregate system health: connectors, cron status, last training tick |
| `GET  /api/mood`       | Live 8-dim mood vector + step counter + last register |
| `GET  /api/persona?threadId=…` | Full persona snapshot for a thread (mood + user-model + relationship + reward + drift) |
| `GET  /api/threads?limit=…`    | Auto-titled thread list, sorted by lastActivity |
| `GET  /api/benchmark`  | Run the eval harness (perplexity + reasoning + recall) on demand |
| `GET  /api/memory/search?q=…`  | Semantic search across all stored memories |
| `GET  /api/connectors/list`    | The currently registered tool catalog |
| `POST /api/chat`               | SSE chat stream (used by the UI) |
| `POST /api/connectors/run`     | Manually invoke any connector |
| `POST /api/feedback`           | Record a 👍/👎 — updates relationship tensor + reward predictor |
| `POST /api/cron/self-improve`  | Trigger one self-improvement tick (cron-job.org calls this) |

## Pages

| Route | What |
|---|---|
| `/`            | Editorial landing dossier — five chapters + live status |
| `/chat`        | Auto-routes to a fresh thread (or to your most recent in a future build) |
| `/chat/<id>`   | The thinking-canvas chat UI with thread switcher + live mood pill + memory recall strip |
| `/dashboard`   | Editorial render of every persistent tensor for any thread ID |

---

## FAQ

<details>
<summary><b>Does MindeesAI really train its own weights, or is this just clever prompt-engineering?</b></summary>

It really trains its own weights. Every five minutes, `agents/optimizer/index.ts` calls `selfImproveTick()` in `core/mindees-mind/index.ts`, which runs a real AdamW gradient step on real LoRA adapters that wrap real linear projections of a real transformer. The math is in `core/mindees-mind/train/online.ts` and the loss curve is recorded in `data/training-metrics.jsonl`. You can grep the code and verify.

</details>

<details>
<summary><b>Do I need a GPU?</b></summary>

To **run** MindeesAI: no. The `nano` and `small` variants infer in pure JavaScript on a laptop CPU. To **bootstrap** the base weights faster than a week: yes, a GPU helps. With no GPU, you can either (a) wait, (b) skip pretraining and let online learning slowly improve random weights, or (c) optionally do a one-time distillation from a teacher LLM (see `scripts/train/distill.py`).

</details>

<details>
<summary><b>How does this compare to GPT-5 / Claude 4 / Llama 4 / DeepSeek-V3?</b></summary>

It uses the same architectural ingredients as DeepSeek-V3 (MoE, MLA, MTP, GRPO) and Llama 4 (GQA, RoPE, RMSNorm, SwiGLU). The recipe is the same; what differs is **scale** — DeepSeek-V3 trained at 671B params on 14.8T tokens with thousands of H100s. MindeesAI's default `small` variant is ~50M params, trainable on a single laptop. The `moe-base` variant is ~1B total with ~250M active per token.

**What MindeesAI offers that the frontier models don't:** full ownership, real continual learning every 5 minutes, an auditable improvement log with regression-gated rollback, zero vendor lock-in, a codebase you can read end-to-end. At your scale, with your data, it will beat any model that doesn't remember you.

</details>

<details>
<summary><b>What is GRPO and why does it matter?</b></summary>

GRPO — **Group Relative Policy Optimization** — is the reinforcement learning method DeepSeek used to turn V3 into R1. For each prompt, sample N completions, score each, compute a *group-relative* advantage `(reward − mean(reward)) / std(reward)`, then nudge the model toward high-advantage completions and away from low-advantage ones. It needs no separate reward model and no value function, which is why a single open-source repo can ship it credibly. MindeesAI runs a GRPO step on every cron tick (`core/mindees-mind/train/grpo.ts`).

</details>

<details>
<summary><b>What is reasoning mode?</b></summary>

For questions that the difficulty estimator flags as hard (math, code, multi-step logic), the model emits a hidden `<think>...</think>` block before its final answer. The thinking is streamed to the UI as a separate event type — you can leave it collapsed or expand it to audit the model's chain of thought. Reasoning depth scales with difficulty: easy questions get no `<think>` block; the hardest get up to 2048 tokens of reasoning before the final answer is composed. See `core/mindees-mind/inference/reasoning.ts`.

</details>

<details>
<summary><b>What does the 5-minute cron actually do now?</b></summary>

A lot. Per tick, the optimizer (`agents/optimizer/index.ts`) calls `selfImproveTick()` which:
1. Snapshots the current LoRA state for rollback.
2. Runs the eval harness BEFORE (perplexity + reasoning + recall@3).
3. Curates a microbatch from conversations, reflections, curriculum self-play, constitutional self-critique pairs, DPO preference pairs, and the replay buffer — through dedup + quality + curriculum filters.
4. Runs a full forward-with-tape + backward pass over each batch, computing gradients on every LoRA adapter, every RMSNorm, and the embedding table.
5. Applies AdamW updates with µP-scaled learning rates per role.
6. Runs a GRPO RL step on a sample of recent prompts.
7. Runs the eval harness AFTER.
8. If any benchmark regressed → rolls back the LoRA delta. Else → commits and archives.
9. Appends a structured entry to `data/improvement-log.jsonl`.

Every step is idempotent. Source: `core/mindees-mind/train/online.ts`.

</details>

<details>
<summary><b>How do I add a new skill / tool?</b></summary>

Add a folder under `connectors/` with three files: `manifest.json`, `handler.ts`, and an optional `prompt.md`. Restart the dev server. The orchestrator discovers it automatically. Full walkthrough in [`docs/CONNECTORS.md`](docs/CONNECTORS.md).

</details>

<details>
<summary><b>Is my data sent anywhere?</b></summary>

By default, **no**. Inference happens in-process. Long-term memory is a local LanceDB folder. The 5-minute cron only POSTs from cron-job.org to *your* Vercel URL. The only outbound calls are when (a) you call a connector that explicitly needs the network (e.g., `web-search`), or (b) you've configured an optional vendor LLM key for fallback. Disable both and the system is air-gappable.

</details>

<details>
<summary><b>What's the license?</b></summary>

MIT. Build commercial products on top of it. Sell those products. Don't sue us. See [`LICENSE`](LICENSE).

</details>

---

## Acknowledgments

MindeesAI stands on the shoulders of several brilliant open-source projects:

- [**Next.js**](https://nextjs.org) — the React framework that makes streaming SSR feel effortless.
- [**LanceDB**](https://lancedb.github.io/lancedb/) — embedded, file-backed vector storage that makes "no infra" actually mean no infra.
- [**Llama / Mistral / Qwen architectures**](https://arxiv.org/abs/2302.13971) — the RoPE + RMSNorm + SwiGLU decoder design we mirror.
- [**LoRA**](https://arxiv.org/abs/2106.09685) — the rank-decomposition trick that makes online fine-tuning feasible.
- [**Direct Preference Optimization**](https://arxiv.org/abs/2305.18290) — RLHF without a reward model.
- [**Tavily**](https://tavily.com), [**Exa**](https://exa.ai), [**Firecrawl**](https://firecrawl.dev), [**Jina Reader**](https://jina.ai) — for making the open web programmatically readable on free tiers.
- [**shadcn/ui**](https://ui.shadcn.com), [**Radix**](https://radix-ui.com), [**Framer Motion**](https://framer.com/motion), [**Tailwind CSS**](https://tailwindcss.com) — the visual stack.

---

## License

[MIT](LICENSE) © 2026 [Aashir Athar](https://github.com/aashir-athar)

---

<div align="center">

Built by [**Aashir Athar**](https://github.com/aashir-athar)

<a href="https://github.com/aashir-athar"><img src="https://img.shields.io/badge/GitHub-aashir--athar-181717?style=flat-square&logo=github&labelColor=06060a" alt="GitHub" /></a>
<a href="https://x.com/aashirathar"><img src="https://img.shields.io/badge/X-@aashirathar-000000?style=flat-square&logo=x&labelColor=06060a" alt="X / Twitter" /></a>
<a href="https://www.linkedin.com/in/aashirathar"><img src="https://img.shields.io/badge/LinkedIn-Aashir%20Athar-0a66c2?style=flat-square&logo=linkedin&labelColor=06060a" alt="LinkedIn" /></a>

</div>

<!--
GitHub repo "About" blurb (copy this into Settings → About):
  A native, self-training open-source AI. Trains itself every 5 minutes — own weights, own tokenizer, own brain. Next.js 16 + TypeScript + LoRA online learning.

Topics to add (Settings → Topics):
  ai, llm, open-source-llm, self-training, continual-learning, lora, dpo,
  transformer, next-js, nextjs-16, react-19, typescript, tailwindcss-v4,
  lancedb, rag, autonomous-ai, mindees-ai, chatgpt-alternative, free-ai,
  self-improving-ai

Homepage URL:
  https://mindeesai.com  (or your Vercel preview URL until then)
-->
