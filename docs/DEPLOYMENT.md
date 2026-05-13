# MindeesAI — Deployment Guide

Three deployment paths, in increasing order of effort:

1. **One-click Vercel** — recommended, ships in ~3 minutes
2. **Manual Vercel** — when you need custom regions, custom envs, or staged rollouts
3. **Self-host (Docker)** — air-gapped, on-prem, or "no cloud" setups

In all three paths, the **5-minute self-improvement loop** is the same code (`/api/cron/self-improve`). Only the trigger differs:
- Vercel Cron (declared in `vercel.json`)
- cron-job.org (free, sub-minute granularity)
- A systemd timer / k8s CronJob (self-host)

---

## Path A — One-click Vercel (fastest)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faashir-athar%2Fmindeesai&project-name=mindeesai&repository-name=mindeesai&env=CRON_SECRET,TAVILY_API_KEY,FIRECRAWL_API_KEY&envDescription=CRON_SECRET%20is%20required.&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D)

The button:
1. Forks `aashir-athar/mindeesai` into your GitHub.
2. Creates a Vercel project pointing at it.
3. Provisions a **Vercel Blob store** for LanceDB snapshots.
4. Prompts for env vars (only `CRON_SECRET` is required).
5. Registers the Vercel Cron job from `vercel.json`.
6. Deploys.

Done. Visit `https://<your-project>.vercel.app`. The first cron tick fires within 5 minutes; verify at `/api/health`.

---

## Path B — Manual Vercel (for power users)

### 1. Push the repo

```bash
git push origin main
```

### 2. Import into Vercel

```bash
pnpm dlx vercel link
pnpm dlx vercel deploy --prod
```

Or via the UI: <https://vercel.com/new> → import the repo. Framework preset auto-detects to `nextjs`.

### 3. Connect a Vercel Blob store

Vercel Dashboard → Storage → **Create Database** → **Blob** → name it `mindeesai-memory` → "Connect to project". This auto-injects `BLOB_READ_WRITE_TOKEN` into your env.

### 4. Environment variables

Set in Vercel → Project → Settings → Environment Variables:

| Required | Recommended | Optional bootstrap |
|---|---|---|
| `CRON_SECRET` | `TAVILY_API_KEY` | `ANTHROPIC_API_KEY` |
|  | `FIRECRAWL_API_KEY` | `OPENAI_API_KEY` |
|  | `MEMORY_PERSISTENCE=vercel-blob` | `XAI_API_KEY` |
|  | (Blob token auto-injected) | `GROQ_API_KEY` |

Generate `CRON_SECRET`:

```bash
openssl rand -hex 32
```

### 5. Verify the cron

```bash
curl -X POST https://<your-project>.vercel.app/api/cron/self-improve \
  -H "Authorization: Bearer $CRON_SECRET" -i
```

Expected: HTTP 200 + a JSON summary with `loss`, `tokens`, `committed`, and the eval-snapshot fields.

The route also accepts Vercel's signed `x-vercel-signature` header — that's how Vercel Cron itself authenticates. You don't need to configure that signature; Vercel does it.

### 6. Optional: register cron-job.org as a backup trigger

Why bother when Vercel Cron already runs every 5 min? Because:
- On the Hobby plan, Vercel Cron is *daily-only*. Cron-job.org fills the gap.
- On Pro, two independent triggers protect against either provider having an outage.

Setup:
1. <https://cron-job.org> → Create cronjob
2. URL: `https://<your-project>.vercel.app/api/cron/self-improve`
3. Schedule: every 5 minutes
4. Method: `POST`
5. Header: `Authorization: Bearer <CRON_SECRET>`

The tick is idempotent — double-firing within 5 minutes does no harm.

---

## Path C — Self-host (Docker)

A `Dockerfile` is not committed by default (Vercel is the recommended path). Skeleton:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS run
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/checkpoints ./checkpoints
COPY --from=build /app/tokenizer  ./tokenizer
ENV NODE_ENV=production
ENV MEMORY_PERSISTENCE=local
ENV LANCEDB_PATH=/data/lancedb
VOLUME /data
EXPOSE 3000
CMD ["pnpm", "start"]
```

`docker-compose.yml`:

```yaml
services:
  mindees:
    build: .
    env_file: .env.local
    environment:
      MEMORY_PERSISTENCE: local
      LANCEDB_PATH: /data/lancedb
    volumes: ["./data:/data"]
    ports: ["3000:3000"]
    restart: unless-stopped
```

Cron via host:

```bash
# /etc/cron.d/mindees-self-improve
*/5 * * * * curl -fsS -X POST http://localhost:3000/api/cron/self-improve \
              -H "Authorization: Bearer ${CRON_SECRET}" > /var/log/mindees-cron.log 2>&1
```

---

## File-system & persistence on Vercel

Vercel functions have a **read-only project filesystem** and a writable `/tmp` (~512MB, resets per function instance).

- `vercel.json` sets `LANCEDB_PATH=/tmp/lancedb` automatically.
- `lib/memory/persistence.ts` ensures `/tmp/lancedb` is hydrated from Vercel Blob on first request, and flushed back after every successful cron tick.
- The flow guarantees that a cold function picks up the latest committed weights of the LanceDB tables.

If a tick fails the eval gate, the **LoRA state rolls back in-memory** AND the next Blob flush is skipped, so the prior committed snapshot remains canonical.

---

## Production readiness checklist

- [ ] `CRON_SECRET` is a 32-byte hex string and lives **only** in Vercel/host secrets
- [ ] `MEMORY_PERSISTENCE=vercel-blob` (on Vercel) or `local` (self-host)
- [ ] `BLOB_READ_WRITE_TOKEN` connected (auto-injected when you connect a Blob store)
- [ ] Rate limit on `/api/chat` (sample middleware in `middleware.ts`)
- [ ] Tavily / Firecrawl quotas monitored — failing closed is OK, failing open is not
- [ ] `data/improvement-log.jsonl` is backed up periodically — alerts if no commit completes for > 30 min
- [ ] `vercel.json` regions match your audience (default: `iad1` — change for non-US traffic)
- [ ] If pretraining: `checkpoints/base.bin` and `tokenizer/tokenizer.json` are shipped in the repo OR uploaded to Blob before first request

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Cron returns 401 | `CRON_SECRET` mismatch | Verify the env var is set in Vercel; for cron-job.org check the `Authorization` header is `Bearer <secret>` |
| `/api/health` shows `lastTrainingTick: null` | No tick has run yet OR all ticks failed | Wait 5 min after deploy; check `data/improvement-log.jsonl` via the file-read connector |
| Cold-start > 3s | Pure-TS model is large at boot | Set `MIND_VARIANT=nano` or pin a warmer region |
| Blob hydration slow | First-ever boot pulling a snapshot | Normal — subsequent cold-starts read the cached snapshot from the function instance |
| Tokens not generated | `tokenizer/tokenizer.json` missing | Either commit a trained tokenizer to the repo, or upload one to Blob and let the persistence adapter hydrate it |
