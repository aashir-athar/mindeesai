# MindeesAI sidecar — runs the native-binary ML and vector workloads that
# Cloudflare Workers cannot execute (V8 isolates can't load .node files).
#
# Hosted on Hugging Face Spaces Docker SDK (free tier, 16 GB RAM, 50 GB
# persistent disk, public HTTPS at https://<user>-<space>.hf.space).
#
# Why an explicit Dockerfile rather than the Node SDK:
#   - Node SDK on HF Spaces tops out at Node 20 and is opinionated about
#     where files live. Our @lancedb/lancedb + @huggingface/transformers
#     stack needs Node 22 + native binary build chain.
#   - Docker SDK gives us full control over runtime + persistent volume
#     mounting (/data is persisted across container restarts).

FROM node:22-bookworm-slim AS base

# Build essentials — @lancedb/lancedb has prebuilt linux-x64 binaries, but
# onnxruntime-node may need build tools depending on transformers.js version.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces convention: app code lives at /app, persistent storage at /data.
WORKDIR /app

# Cache npm install across rebuilds — only re-run if package files change.
COPY package.json package-lock.json* ./
RUN npm clean-install --no-audit --no-fund

# Now copy source. tsc happens at runtime via tsx (no separate build step).
COPY . .

# HF Spaces sets PORT=7860 by default. We honour that but also accept any
# override via env.
ENV PORT=7860
ENV NODE_ENV=production
ENV SIDECAR_DATA_DIR=/data/sidecar

# /data is the HF Spaces persistent mount — survives container restarts.
# LanceDB tables + transformers.js model cache both live under it.
VOLUME ["/data"]

EXPOSE 7860

# tsx runs TypeScript directly; no separate build/compile step needed.
CMD ["npx", "tsx", "src/server.ts"]
