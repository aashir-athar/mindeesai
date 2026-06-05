<div align="center">

<a href="https://github.com/aashir-athar/mindeesai">
  <img alt="MindeesAI logo" src="https://raw.githubusercontent.com/aashir-athar/mindeesai/main/public/assets/mind-logo.png" width="140" height="140" />
</a>

# 🧠 MindeesAI

**A native, self-training open-source LLM built from scratch in TypeScript — the model trains itself, and you own the weights.**

> DeepSeek-V3-class architecture — Mixture of Experts · Multi-head Latent Attention · Multi-Token Prediction · GRPO · Reasoning Mode · Continual Learning — with zero vendor lock-in.

[![Stars](https://img.shields.io/github/stars/aashir-athar/mindeesai?style=for-the-badge&logo=github&color=FFD33D)](https://github.com/aashir-athar/mindeesai/stargazers)
[![License](https://img.shields.io/github/license/aashir-athar/mindeesai?style=for-the-badge&color=blue)](./LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/aashir-athar/mindeesai?style=for-the-badge)](https://github.com/aashir-athar/mindeesai/commits/main)
[![Top language](https://img.shields.io/github/languages/top/aashir-athar/mindeesai?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/aashir-athar/mindeesai)
[![Build](https://img.shields.io/github/actions/workflow/status/aashir-athar/mindeesai/pretrain.yml?style=for-the-badge&label=pretrain)](https://github.com/aashir-athar/mindeesai/actions)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?style=flat-square&logo=tailwindcss&logoColor=white)
![LanceDB](https://img.shields.io/badge/LanceDB-vector-FBBF24?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)

<a href="./docs"><strong>📚 Documentation</strong></a> ·
<a href="https://github.com/aashir-athar/mindeesai/issues"><strong>🐛 Report Bug</strong></a> ·
<a href="https://github.com/aashir-athar/mindeesai/issues"><strong>✨ Request Feature</strong></a>

</div>

---

**MindeesAI** is a free, **open-source self-training language model** that you run yourself — not a thin wrapper around someone else's API. The decoder-only transformer, the BPE tokenizer, the gradient-descent training loop, and the continual-learning pipeline all live in this repository, written in **TypeScript** with a **Python** path for heavy pretraining. It implements a **DeepSeek-V3-class architecture** (MoE, MLA, MTP, GRPO) with vector-memory RAG, autonomous web research, and a streaming **Next.js 16** chat UI — so you own the model, the weights, and the data.

> 🚧 **Active development.** MindeesAI is an ambitious, fast-moving research project (`v0.2.0`). Treat it as an evolving reference implementation, not a frozen release — APIs and internals change.

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🧬 | **Native model, not a wrapper** | A from-scratch decoder-only transformer in TypeScript — MoE, MLA, MTP, GQA, RoPE, RMSNorm, SwiGLU, tied embeddings. Inference and training run locally. |
| ♻️ | **Continual-learning loop** | A scheduled cron tick runs the lightweight learning loops (reflection, autonomous research, journaling, memory consolidation), while a weekly GitHub Actions workflow retrains the weights on your own conversations and publishes the checkpoint to the Hugging Face Hub. |
| 🧠 | **Reasoning mode** | DeepSeek-R1-style hidden `<think>` blocks, best-of-N critic scoring, and speculative decoding for faster generation. |
| 🎓 | **Modern training recipe** | GRPO + DPO RLHF from 👍/👎 feedback, constitutional self-critique, curriculum self-play, replay buffer, and eval-gated commits with automatic rollback. |
| 🔎 | **Vector memory + RAG** | LanceDB semantic recall across every conversation, with a cross-encoder reranker on top of the bi-encoder embedder. |
| 🌐 | **Autonomous web research** | An eight-provider research chain (Tavily · Exa · JINA · DuckDuckGo · Wikipedia · arXiv · Reddit · HackerNews) — five of them key-less, so research works with **zero API keys**. |
| 🔌 | **17 drop-in connectors** | Calculator, code-exec, web-search, web-crawl, Wikipedia, GitHub, StackOverflow, arXiv, PubMed, and more — add your own by dropping a folder under `/connectors`. |
| 🤖 | **9 local ML models** | Embedder, reranker, emotion, sentiment, NER, toxicity, PII-guard, topic-router, and summariser run on-device via `@huggingface/transformers` — no GPU, no external API. |
| 🛡️ | **Resilient by design** | A multi-provider LLM fallback router walks free tiers on `429`/`5xx`, with handshake and per-chunk stall timeouts so a stalled stream fails over instead of hanging. |
| 📊 | **Fully auditable** | Dashboard, journal, research log, and memory-graph pages let you inspect the persona state, autonomous research, and learned facts in real time. |

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router · RSC · Turbopack) |
| **UI runtime** | React 19 |
| **Language** | TypeScript (strict, `noUncheckedIndexedAccess`) |
| **Styling** | Tailwind CSS v4 · Radix UI · Framer Motion |
| **Native model** | Custom decoder-only transformer (MoE · MLA · MTP · GQA · RoPE) |
| **Pretraining** | Python · PyTorch (`scripts/train/`) |
| **Tokenizer** | Byte-level BPE (TS + Python) |
| **Vector memory** | LanceDB + cross-encoder rerank |
| **Local ML** | `@huggingface/transformers` (transformers.js, Q8) |
| **Validation** | Zod |
| **Streaming** | Native SSE + ReadableStream |
| **Deployment** | Vercel · Cloudflare Workers (OpenNext) · Hugging Face Hub (checkpoints) |

## 🚀 Getting Started

### Prerequisites

- **Node.js** `>= 22`
- **npm** (ships with Node)
- *(Optional)* **Python 3.10+** + PyTorch — only for the native-model pretraining path
- *(Optional)* API keys (Groq, Google, Tavily, Firecrawl…) — every key is optional; the app degrades gracefully without them

### Installation

```bash
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai
npm install
```

### Configure

```bash
cp .env.example .env.local
# Everything is optional except CRON_SECRET — generate it with:
openssl rand -hex 32
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

<details>
<summary><strong>Deploy to Vercel (one click)</strong></summary>

The fastest path to a live instance. `CRON_SECRET` is required; `TAVILY_API_KEY` and `FIRECRAWL_API_KEY` are optional (free tiers) and unlock the web-search and web-crawl connectors. Configure runtime persistence with Cloudflare R2 for a fully free, sustainable setup — see [`docs/CLOUDFLARE_HF_DEPLOY.md`](./docs/CLOUDFLARE_HF_DEPLOY.md).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai)

</details>

## 📖 Usage

### Available scripts

```bash
npm run dev          # Start the Next.js dev server
npm run build        # Production build
npm run start        # Serve the production build
npm run lint         # Lint with ESLint (next lint)
npm run typecheck    # Type-check with tsc --noEmit
npm test             # Run the Vitest suite
npm run bootstrap    # First-time setup / scaffolding
```

### Train the native model (optional)

```bash
# Train the BPE tokenizer
npm run tokenizer:train

# Heavy pretraining runs via Python (local GPU) or the weekly GitHub Actions workflow
python scripts/train/pretrain.py --help
```

After deploying, visit `/setup` for a color-coded health board, then `/dashboard`, `/journal`, `/research`, and `/memory-graph` to audit how the model is learning. See [`QUICKSTART.md`](./QUICKSTART.md) and [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) for the full walkthrough.

## 🗺️ Roadmap

- [x] Native TypeScript decoder-only transformer (MoE · MLA · MTP)
- [x] Continual-learning cron loop + weekly GitHub Actions pretrain
- [x] LanceDB vector memory with cross-encoder rerank
- [x] Eight-provider autonomous research chain
- [x] On-device PII guard, topic router, and summariser
- [ ] Expanded WebGPU-accelerated inference
- [ ] Larger published checkpoints on the Hugging Face Hub
- [ ] Connector marketplace

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the detailed plan.

## 🤝 Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and open an issue first for major changes.

1. Fork the repository
2. Create a branch (`git checkout -b feat/your-feature`)
3. Commit your changes and run `npm run lint && npm run typecheck && npm test`
4. Push and open a Pull Request

## 📄 License

Distributed under the **MIT** License. See [`LICENSE`](./LICENSE) for details.

## 👤 Author

**Aashir Athar**

[![GitHub](https://img.shields.io/badge/GitHub-aashir--athar-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/aashir-athar)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-aashirathar-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/aashirathar/)
[![X](https://img.shields.io/badge/X_(Twitter)-aashirathar-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/aashirathar)

---

<div align="center">

<sub>Built by <a href="https://github.com/aashir-athar">aashir-athar</a> · If MindeesAI helped or inspired you, consider leaving a ⭐</sub>

<br/><br/>

<sub><strong>Keywords:</strong> open-source LLM · self-training AI · continual learning · DeepSeek-V3 architecture · Mixture of Experts · MLA · MTP · GRPO · LoRA fine-tuning · transformer from scratch · RAG · LanceDB vector database · autonomous AI agent · Next.js 16 · React 19 · TypeScript · Tailwind CSS · transformers.js · local LLM</sub>

</div>
