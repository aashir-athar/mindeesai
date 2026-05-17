# Deploying MindeesAI on Cloudflare Workers + Hugging Face Spaces

**Cost: $0/mo forever.** Cloudflare Workers Free (100k req/day) + HF Spaces
Docker Free (16 GB RAM) + R2 Free (10 GB / 1M ops) + HF Hub Free.

## Architecture

```
[Browser]
    ↓ HTTPS
[Cloudflare Workers]  — chat routing, SSE streaming, R2 persistence
    │
    ├─→ External LLM APIs (Groq, Gemini, Claude, OpenAI) — already HTTP
    │
    └─→ HTTPS + Bearer ─→ [HF Spaces Docker sidecar]
                              ├─ LanceDB (vector store on /data)
                              └─ transformers.js (7 ML pipelines)
```

Native binaries (LanceDB, onnxruntime-node) live in the sidecar because V8
isolates (Workers) can't load `.node` files. Workers handles everything
that doesn't touch native code.

## Step 1 — Deploy the sidecar to Hugging Face Spaces

1. **Create the Space:**
   - Go to https://huggingface.co/new-space
   - Space name: `mindeesai-sidecar`
   - Owner: your HF username
   - SDK: **Docker**
   - Hardware: **CPU Basic** (free)
   - Visibility: **Public** (private requires paid tier)
   - Click Create.

2. **Upload the sidecar contents.** Two options:

   **Option A — git push from local clone:**
   ```bash
   cd scripts/sidecar
   git init
   git remote add hf https://huggingface.co/spaces/<your-user>/mindeesai-sidecar
   git add .
   git commit -m "Initial sidecar deploy"
   git push hf main
   ```

   **Option B — drag the contents into the Space's Files tab:**
   Upload everything inside `scripts/sidecar/` (Dockerfile, package.json,
   tsconfig.json, README.md, src/) to the Space's root.

3. **Set the auth secret:**
   - Space → Settings → Variables and secrets → New secret
   - Name: `SIDECAR_AUTH_TOKEN`
   - Value: a long random string. Generate one:
     ```bash
     openssl rand -hex 32
     ```
     Save this string — you'll need it for Cloudflare too.

4. **Wait for the Docker build.** First build takes 3–5 minutes (npm install
   pulls @lancedb/lancedb + @huggingface/transformers ARM binaries; HF
   Spaces runs ARM). Watch the build logs in the Space → Logs tab.

5. **Verify the sidecar is live:**
   ```bash
   curl https://<your-user>-mindeesai-sidecar.hf.space/health
   # → {"ok":true,"ts":"...","lancedb":{"ok":true,"tables":[]}}
   ```
   Note your Space's public URL. Format is
   `https://<user>-<space-name>.hf.space`.

6. **Quick smoke test (with auth):**
   ```bash
   TOKEN=<your SIDECAR_AUTH_TOKEN>
   curl -X POST https://<your-user>-mindeesai-sidecar.hf.space/embed \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"text":"hello world"}'
   # → {"vector":[0.012,-0.041,...],"dim":384}
   # First call triggers BGE-small download (~5-10 sec). Subsequent: ~50ms.
   ```

## Step 2 — Deploy the main app to Cloudflare Workers

1. **Sign up at Cloudflare** (https://dash.cloudflare.com) — free, no
   credit card required for the Workers Free plan.

2. **Install Wrangler locally:**
   ```bash
   npm install            # picks up the new wrangler + @opennextjs/cloudflare devDeps
   npx wrangler login     # opens browser, authorizes wrangler with your CF account
   ```

3. **Create the R2 bucket** (skip if you already have one):
   ```bash
   npx wrangler r2 bucket create mindeesai
   ```
   The bucket name MUST match `bucket_name` in `wrangler.toml`. If you used
   a different bucket name on Vercel, either rename it via the Cloudflare
   dashboard or update `wrangler.toml`.

4. **Set Worker secrets.** Run each command (it'll prompt for the value):
   ```bash
   npx wrangler secret put SIDECAR_URL
   # paste: https://<your-user>-mindeesai-sidecar.hf.space

   npx wrangler secret put SIDECAR_AUTH_TOKEN
   # paste: the same token you set on the HF Space

   npx wrangler secret put HF_TOKEN
   # paste: your HuggingFace token (any scope)

   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   # ... and any other LLM providers you use

   npx wrangler secret put R2_ACCOUNT_ID
   npx wrangler secret put R2_BUCKET           # = "mindeesai"
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   ```

   To find R2 keys: Cloudflare dashboard → R2 → Manage R2 API Tokens →
   Create API token with Read+Write on the `mindeesai` bucket.

5. **Build + deploy:**
   ```bash
   npm run cf:deploy
   ```
   This runs `opennextjs-cloudflare build && opennextjs-cloudflare deploy`.
   First deploy: ~3-5 min. You'll get a URL like
   `https://mindeesai.<your-subdomain>.workers.dev`.

6. **Smoke test the live app:**
   ```bash
   curl https://mindeesai.<your-subdomain>.workers.dev/api/health
   # → {"ok":true, ...}
   ```

## Step 3 — Custom domain (optional)

Workers Free supports custom domains for free as long as the domain is
on Cloudflare DNS.

1. Cloudflare dashboard → Websites → Add a site → enter your domain.
2. Cloudflare gives you 2 nameservers — set them at your registrar.
3. Wait for DNS to propagate (~5 min – 24 h depending on TTL).
4. Once Cloudflare reports Active: Workers → mindeesai → Settings →
   Domains & Routes → Add Custom Domain → `chat.yourdomain.com`.
5. Update `NEXT_PUBLIC_SITE_URL` secret:
   ```bash
   npx wrangler secret put NEXT_PUBLIC_SITE_URL
   # paste: https://chat.yourdomain.com
   npm run cf:deploy
   ```

## Step 4 — Verify the hybrid is healthy

Hit each path:

```bash
BASE=https://mindeesai.<your-subdomain>.workers.dev  # or your custom domain

# Main app health (Worker → sidecar /health pass-through via the
# LanceDB health check in lib/memory/lancedb.ts):
curl $BASE/api/health | jq

# Memory endpoint (Worker → sidecar /memory/recall):
curl "$BASE/api/memory/search?q=hello"

# Chat (full stack: Worker → external LLM provider, no sidecar hop):
curl -N -X POST $BASE/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

## Keeping the sidecar warm

HF Spaces hibernates Docker containers after **48 hours of zero traffic**.
The 30-min Workers cron at `*/30 * * * *` (defined in `wrangler.toml`) hits
`/api/cron/self-improve`, which internally calls the sidecar — that's
your keep-alive. The sidecar never sleeps as long as the cron stays on.

If you ever pause the cron, the next request after sleep takes 30-60 sec
to wake the sidecar. Subsequent requests are instant.

## Troubleshooting

**`SIDECAR_URL` not set / memory writes are no-ops**

Check the Worker logs:
```bash
npx wrangler tail
```
Look for `[memory] SIDECAR_URL not configured`. If you see it, the secret
didn't get set or didn't deploy. Re-run `wrangler secret put SIDECAR_URL`,
then `npm run cf:deploy`.

**Sidecar returns 401 unauthorized**

Token mismatch between Worker secret and HF Space secret. Both must be
the exact same string. Re-set both:
```bash
TOKEN=$(openssl rand -hex 32)
echo "Use this for both:"
echo "$TOKEN"
# Then set it both on the HF Space (Settings → Secrets) AND on Workers
# via: npx wrangler secret put SIDECAR_AUTH_TOKEN
```

**HF Space build fails on `@lancedb/lancedb` install**

Check the Space's build logs. Most common cause: HF Spaces is now ARM but
@lancedb/lancedb's prebuilt ARM binaries are an opt-in package. Add the
ARM dep explicitly to `scripts/sidecar/package.json`:
```json
{
  "optionalDependencies": {
    "@lancedb/lancedb-linux-arm64-gnu": "^0.27.2"
  }
}
```
Push to the Space, rebuild.

**Worker build hits `No loader is configured for ".node" files`**

This is the original failure mode — it means a native module sneaked
back into the main bundle. Grep for the offender:
```bash
grep -rn "@lancedb/lancedb\|@huggingface/transformers\|onnxruntime-node" \
  app/ lib/ agents/ core/
```
Should ONLY appear in `scripts/sidecar/` and in comments. If any
non-sidecar file imports them, refactor that file to call the sidecar
client instead.

**Memory operations are slow (~1 sec per recall)**

Expected — first sidecar call after a sleep wakes the container (~30 sec
cold start), then BGE-small loads on first `/embed` call (~5-10 sec for
download from HF, ~1 sec subsequent cold per process). After that, memory
recalls are ~50-200 ms (HTTP roundtrip + LanceDB search). If you're
seeing >1 sec consistently, your cron isn't keeping the sidecar warm —
check Workers → Cron Events log.

## What's different vs the old Vercel deploy

| Concern | Vercel (paused) | Cloudflare + HF (now) |
|---|---|---|
| Web app runtime | Node serverless | V8 Workers |
| CPU quota | 4 h/mo (you hit 3×) | 100k requests/day (effectively unlimited) |
| Cold starts | Yes (Hobby) | <5 ms (isolate) |
| Memory budget | 1024 MB | 128 MB Workers (+ sidecar 16 GB) |
| Cron | Vercel Crons (5 min) | Workers Crons (30 min) |
| Persistence | R2 (already) | R2 (unchanged) |
| Vector store | LanceDB in-process | LanceDB on sidecar |
| ML inference | transformers.js in-process | transformers.js on sidecar |
| Memory ops latency | <10 ms | 50–200 ms |
| Custom domain | Free | Free (on CF DNS) |
| Monthly cost | $0 (until quota) | $0 forever |

The latency hit on memory ops is real but the chat path itself (LLM
provider call → SSE streaming) doesn't touch the sidecar, so the
user-visible response time is unchanged.

## Rolling back

If anything goes sideways, the old Oracle Cloud guide
([ORACLE_CLOUD_DEPLOY.md](ORACLE_CLOUD_DEPLOY.md)) deploys the same code
unchanged on a real VM. Sidecar + main app both run on the same Oracle
ARM box. Same `$0/mo`. Slower (no global edge) but operationally
simpler.

Or worst case: re-enable Vercel Hobby once the CPU quota resets at
month start, knowing it'll pause again after another ~4 hours of compute.
