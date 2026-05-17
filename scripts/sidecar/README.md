---
title: mindeesai-sidecar
emoji: 🧠
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
short_description: LanceDB + transformers.js sidecar for MindeesAI
---

# MindeesAI sidecar

Native-binary ML and vector workloads (LanceDB, transformers.js) that the
main MindeesAI app — hosted on Cloudflare Workers — cannot run because V8
isolates can't load `.node` files. This sidecar runs on Hugging Face
Spaces Docker (free tier, 16 GB RAM, 50 GB persistent disk).

The main app calls this sidecar over HTTPS for every memory read/write
and every ML classification.

## Architecture

```
[Browser]
   ↓ HTTPS
[Cloudflare Workers] ── R2 (persistence)
   │
   └── HTTPS+Bearer ─→ [This sidecar on HF Spaces]
                           ├─ LanceDB (vector store, on /data)
                           └─ transformers.js (7 ML pipelines)
```

## Free-tier behaviour

- **16 GB RAM** — enough for all 7 transformers.js pipelines loaded
  simultaneously (~705 MB worst case Q8).
- **50 GB persistent storage** at `/data` — LanceDB tables + transformers.js
  model cache live here. Survives container restarts.
- **Idle sleep after 48h** — HF Spaces hibernates inactive containers.
  The main app's 30-min cron pings `/health`, keeping the sidecar
  warm indefinitely.
- **Cold start** — ~30-60 sec from sleep to first response. First call
  after cold start triggers transformers.js model load (~5-15 sec per
  model, lazy on first use of each pipeline).

## Deployment

1. Create a new Space at https://huggingface.co/new-space
   - SDK: Docker
   - Hardware: CPU Basic (free)
   - Visibility: Public (private requires a paid tier on HF)
2. Push this directory's contents as the Space contents. Repo layout
   when pushed:
   ```
   /Dockerfile
   /package.json
   /tsconfig.json
   /README.md      ← this file, with HF YAML frontmatter
   /src/server.ts
   ```
3. In the Space's **Settings → Variables and secrets**:
   - Add secret `SIDECAR_AUTH_TOKEN` = (generate a long random string;
     also set as `SIDECAR_AUTH_TOKEN` in Cloudflare Workers env)
4. Wait for the Space to build (~3-5 min first time).
5. Verify health: `curl https://<user>-mindeesai-sidecar.hf.space/health`
   should return `{"ok": true, ...}`.

## Endpoints

All endpoints except `/health` and `/` require an `Authorization: Bearer
<SIDECAR_AUTH_TOKEN>` header. All accept and return JSON.

| Endpoint | Method | Phase | Purpose |
|---|---|---|---|
| `/health` | GET | P1 | Liveness probe (no auth) |
| `/` | GET | P1 | Status banner (no auth) |
| `/embed` | POST | P2 | Text → 384-dim BGE-small vector |
| `/memory/recall` | POST | P2 | Top-K over LanceDB memories |
| `/memory/remember` | POST | P2 | Insert into memories table |
| `/memory/promote` | POST | P2 | Insert into insights table |
| `/memory/recall-insights` | POST | P2 | Top-K over insights table |
| `/pii` | POST | P3 | Piiranha PII detection + redaction |
| `/classify` | POST | P3 | Zero-shot / sentiment / toxicity / NER |
| `/rerank` | POST | P3 | ms-marco cross-encoder rerank |
| `/summarize` | POST | P3 | DistilBART abstractive summary |

Phase 1 ships with all P2/P3 endpoints returning HTTP 501 NOT_IMPLEMENTED
so the routing surface is observable before the implementations land.

## Local development

```bash
cd scripts/sidecar
npm install
SIDECAR_AUTH_TOKEN=dev-token npm run dev
# In another terminal:
curl http://localhost:7860/health
curl -X POST http://localhost:7860/embed \
     -H "Authorization: Bearer dev-token" \
     -H "Content-Type: application/json" \
     -d '{"text": "hello"}'
# → 501 NOT_IMPLEMENTED (until P2 lands)
```

## Why a separate process, not a Worker?

Cloudflare Workers run in V8 isolates. They cannot load native `.node`
binaries — `@lancedb/lancedb` and `onnxruntime-node` (which
`@huggingface/transformers` depends on for non-WASM execution) both ship
as compiled native modules. This is a runtime constraint, not a config
issue. No esbuild flag fixes it.

The pragmatic alternatives were:
1. **Drop the native deps**: rewrite memory on Vectorize, drop all 7 ML
   classifiers — materially worse capability.
2. **Pay $5/mo for Cloudflare Containers**: zero refactor, but not free.
3. **This: host the natives elsewhere, keep the chat path on Workers**:
   $0/mo, full capability, +50–200 ms latency on memory queries.

We chose option 3.
