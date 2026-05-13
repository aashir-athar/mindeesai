# MindeesAI — Roadmap

> Realistic milestones, ordered by leverage. Help wanted on anything tagged `good first issue`.

---

## v0.1 — Foundation (shipped)

- [x] Next.js 16 + React 19 + Tailwind v4 scaffold
- [x] Local-first LLM via Ollama
- [x] LanceDB long-term memory
- [x] Tavily web search + Firecrawl/Jina deep read
- [x] Cron-driven self-improvement loop (5-min cadence)
- [x] Connector plugin system
- [x] Awwwards-tier dark cinematic UI
- [x] Streaming chat with citations

## v0.2 — Reliability

- [ ] Vercel Blob persistence adapter for LanceDB
- [ ] Per-thread retrieval weights (not just global)
- [ ] Connector permission sandbox with `vm.SourceTextModule`
- [ ] OpenTelemetry traces for the chat → tool → llm path
- [ ] Rate-limit middleware with Upstash Redis adapter

## v0.3 — Intelligence

- [ ] Graph memory promotion (auto-extract entities + relationships)
- [ ] Cross-thread distillation (insights that span > 1 conversation)
- [ ] Adversarial critic agent (catches hallucinations before user sees them)
- [ ] Per-user fine-tuning via LoRA adapters
- [ ] Vision input via local LLaVA / Florence-2

## v0.4 — Reach

- [ ] Mobile-first responsive overhaul + PWA install prompt
- [ ] Voice in/out (Whisper local + Piper TTS)
- [ ] Multi-language UI (i18n via `next-intl`)
- [ ] Public connector marketplace (community-curated)
- [ ] Browser extension for "ask MindeesAI about this page"

## v1.0 — Trust

- [ ] SOC-2-ready audit logs
- [ ] Air-gapped mode (zero network egress)
- [ ] Cryptographic attestation of improvement-log
- [ ] Public benchmark harness (vs. Claude/o3/Codex on reasoning + recall)
- [ ] Documented eval suite + leaderboard

---

## How to contribute

- Issues tagged **`good first issue`** are scoped at 1–4 hours of work with clear acceptance criteria.
- Issues tagged **`research`** are open-ended — propose a design in the issue thread first.
- See [CONTRIBUTING.md](../CONTRIBUTING.md).
