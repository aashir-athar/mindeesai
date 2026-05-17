# Deploying MindeesAI on Oracle Cloud Always Free (ARM Ampere)

Oracle Cloud's Always Free tier gives you **24 GB RAM + 4 OCPUs** on ARM
Ampere A1 — for free, forever. This is the most generous truly-free
compute offer that exists in 2026. Unlike Vercel Hobby or Cloudflare
Workers, you get a **full Linux VM** that runs MindeesAI's current code
as-is — including the native `@lancedb/lancedb` and `onnxruntime-node`
binaries that Cloudflare Workers cannot load.

**Total setup time:** ~2 hours one-time. Subsequent re-deploys are
`git pull && npm run build && systemctl restart mindeesai` (~30 sec).

**Trade-offs vs Vercel:**

| Aspect | Vercel Hobby | Oracle Always Free |
|---|---|---|
| Setup time | 5 min | 2 hours one-time |
| CPU quota | 4 h / month | Unlimited |
| Memory | ~1 GB function | 24 GB |
| Native modules | No (lancedb fails) | Yes (full Linux) |
| Cold starts | Yes | No (always-on) |
| Auto-scaling | Yes | No (you own the VM) |
| SSL / DNS / nginx | Automatic | You configure (one-time) |
| Cost | Free until quota | Free forever |

---

## Pre-requisites

1. **Oracle Cloud account** — free signup at https://www.oracle.com/cloud/free/. **A credit card is required for verification** (no charge, but Oracle uses it to deter abuse). If your card is rejected, try a different country in the signup form (US/EU is most reliable).

2. **A domain name** (optional but recommended). Free options:
   - `mindeesai.duckdns.org` (free, no signup beyond GitHub OAuth)
   - `mindeesai.is-a.dev` (free for developers)
   - Any domain you already own
   - Falls back to: just use the VM's public IP

3. **HuggingFace + R2 + LLM provider keys** — same as your Vercel env. You'll port them over.

---

## Step 1: Provision the ARM VM

After Oracle account creation:

1. Navigate to **Compute → Instances → Create instance**
2. **Name:** `mindeesai-prod`
3. **Image:** Click *Change image* → **Ubuntu 22.04 LTS** (or 24.04 if available)
4. **Shape:** Click *Change shape* →
   - **Shape series:** Ampere
   - **Shape:** `VM.Standard.A1.Flex`
   - **OCPUs:** `4`
   - **Memory:** `24 GB`
   - This entire config is **within Always Free**. No charges.
5. **Networking:** Leave defaults — Oracle creates a VCN and public subnet automatically. Confirm **Assign a public IPv4 address** is checked.
6. **SSH keys:**
   - **Generate a key pair for me** → Download both private and public keys. Save the private key somewhere safe (e.g., `~/.ssh/mindeesai_oracle`).
   - OR paste your existing public key.
7. **Boot volume:** Default is 47 GB which is fine. If asked to upgrade, decline.
8. Click **Create**.

VM provisioning takes ~2 minutes. Once status shows **Running**, copy the **Public IPv4 address** from the instance details page.

### Capacity caveat

Oracle Always Free ARM capacity is finite per region. If you see *"Out of capacity"*, try a different availability domain or region (some popular ones: `us-ashburn-1`, `eu-frankfurt-1`, `ap-tokyo-1`). The Oracle community has scripts that retry until capacity opens, but manually retrying every few hours over a day usually works.

---

## Step 2: Networking

Oracle's default Security List blocks all inbound traffic except SSH (22). Open ports 80 and 443 for HTTP/HTTPS:

1. From the VM instance page, click on the **VCN** under *Primary VNIC*
2. Click **Default Security List for vcn-xxx**
3. **Add Ingress Rules:**
   - **Rule 1:** Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination port `80`
   - **Rule 2:** Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination port `443`
4. Save.

You also need to open Ubuntu's host firewall. SSH into the VM (next step) and run:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Without both layers (Security List + iptables), HTTP requests will silently drop.

---

## Step 3: Initial server setup

SSH in from your local machine:

```bash
ssh -i ~/.ssh/mindeesai_oracle ubuntu@<PUBLIC_IP>
```

(`ubuntu` is the default user for Oracle's Ubuntu image.)

Once in, run:

```bash
# System updates
sudo apt update && sudo apt upgrade -y

# Build essentials (some npm packages compile native code on install)
sudo apt install -y build-essential git curl unzip ca-certificates gnupg netfilter-persistent

# Node 22 (matches your Vercel build environment)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # should print v22.x.x
npm -v    # should print 10.x.x

# nginx + Certbot for SSL
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## Step 4: Clone and configure MindeesAI

```bash
# Clone the repo
cd ~
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai

# Install dependencies (this will compile native @lancedb + onnxruntime-node
# for ARM64 — takes 2-3 min on the A1 cpu)
npm clean-install

# If you see "no prebuilt binary for arm64" for any package, that means the
# package needs to compile from source. Usually works automatically. If a
# specific package fails, the error message will tell you which build tools
# are missing.
```

### Environment variables

Create `.env.production` in the repo root with your real values:

```bash
cat > .env.production <<'EOF'
# === LLM providers ===
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...        # optional fallback
ANTHROPIC_API_KEY=sk-ant-... # optional fallback

# === HuggingFace ===
HF_TOKEN=hf_...
HF_MODEL_REPO=aashir-athar/mindeesai-base
HF_MODEL_REVISION=main       # or small-weekly / kaggle-weekly

# === Cloudflare R2 (persistence) ===
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
MEMORY_PERSISTENCE=cloudflare-r2

# === Other ===
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_BASE_URL=https://yourdomain.com   # or http://<PUBLIC_IP>
EOF

# Secure it — never world-readable
chmod 600 .env.production
```

### Build the production bundle

```bash
npm run build
```

This produces `.next/` with the compiled app. Takes ~30-60 sec on the A1 CPU.

---

## Step 5: Run as a systemd service

systemd manages the Node process — restarts on crash, starts on boot, captures logs.

```bash
sudo tee /etc/systemd/system/mindeesai.service > /dev/null <<'EOF'
[Unit]
Description=MindeesAI Next.js production server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mindeesai
EnvironmentFile=/home/ubuntu/mindeesai/.env.production
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mindeesai

# Memory limit — generous, but stops a runaway from crashing the VM
MemoryMax=18G

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mindeesai
sudo systemctl start mindeesai

# Verify
sudo systemctl status mindeesai
# Logs:
journalctl -u mindeesai -f
```

The app is now running on `http://<PUBLIC_IP>:3000` (but port 3000 isn't open externally — nginx will proxy it).

---

## Step 6: nginx reverse proxy

nginx accepts HTTPS on 443, forwards to `localhost:3000`. This lets Certbot manage SSL automatically.

```bash
sudo tee /etc/nginx/sites-available/mindeesai > /dev/null <<'EOF'
server {
    listen 80;
    server_name yourdomain.com;   # ← REPLACE with your domain or _

    # Buffer + timeout tuning for SSE chat streaming
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mindeesai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t       # syntax check
sudo systemctl reload nginx
```

Test: `http://<PUBLIC_IP>` should now serve MindeesAI.

**SSE caveat:** the `proxy_buffering off` line above is critical — without it nginx buffers your chat stream and the UI shows nothing until the response completes. The proxy_read_timeout 600s gives long LLM responses room to finish without nginx killing the connection.

---

## Step 7: Point DNS + enable SSL

**If you have a domain:**

1. In your DNS provider (Cloudflare recommended — free + fast):
   - Add an **A record**: `mindeesai.yourdomain.com` → `<PUBLIC_IP>`
   - If using Cloudflare, set proxy status to **DNS only** (grey cloud) for now. After SSL works, you can enable the orange cloud (proxied) for extra DDoS protection.
2. Wait 1-5 min for DNS propagation. Verify with `dig mindeesai.yourdomain.com`.
3. Issue an SSL cert:
   ```bash
   sudo certbot --nginx -d yourdomain.com   # answer prompts; agree to ToS
   ```
   Certbot auto-edits your nginx config, redirects HTTP → HTTPS, and sets up auto-renewal via systemd timer.

**If you don't have a domain:**

Use **DuckDNS** (free, no signup beyond GitHub OAuth):

1. Go to https://www.duckdns.org, sign in with GitHub
2. Create subdomain `mindeesai` → DuckDNS gives you `mindeesai.duckdns.org`
3. Set the IP in DuckDNS to `<PUBLIC_IP>`
4. Update your nginx config's `server_name` to `mindeesai.duckdns.org`
5. Run `sudo certbot --nginx -d mindeesai.duckdns.org`

After SSL is live, **update `NEXT_PUBLIC_BASE_URL` in `.env.production`** to `https://mindeesai.duckdns.org`, then `sudo systemctl restart mindeesai`.

---

## Step 8: External cron (replaces Vercel's cron)

Vercel ran `/api/cron/self-improve` every 5 min via Vercel Crons. Replicate that with **cron-job.org** (free):

1. Sign up at https://cron-job.org
2. **Create a cronjob:**
   - URL: `https://yourdomain.com/api/cron/self-improve`
   - Schedule: `*/30 * * * *` (every 30 min — recommended over every-5-min to keep CPU usage modest)
   - HTTP method: GET
   - Add a header `Authorization: Bearer <YOUR_CRON_SECRET>` if your endpoint expects auth
3. Save. cron-job.org will now ping your endpoint on schedule.

You can also run cron on the VM itself with systemd timers, but external cron has zero server-side CPU cost and survives VM reboots cleanly.

---

## Step 9: Updates and rollouts

After committing changes locally and pushing to GitHub:

```bash
ssh ubuntu@<PUBLIC_IP>
cd ~/mindeesai
git pull
npm clean-install   # only if package.json changed; skip otherwise to save 60 sec
npm run build
sudo systemctl restart mindeesai
```

Or wrap in a deploy script `~/deploy.sh`:

```bash
#!/bin/bash
set -e
cd ~/mindeesai
git pull origin main
if git diff HEAD@{1} HEAD --name-only | grep -q package; then
  npm clean-install
fi
npm run build
sudo systemctl restart mindeesai
echo "✓ deployed at $(date)"
```

---

## Troubleshooting

**Build fails: "no prebuilt binary for arm64" on some npm package**

Most modern packages have ARM64 prebuilt binaries. If one doesn't:
- Check the package's GitHub for an `--ignore-engines` option
- Try `npm install --build-from-source` (slow but usually works)
- Worst case: pin to a version that has ARM binaries (`npm install package@x.y.z`)

`@lancedb/lancedb` and `onnxruntime-node` both have native ARM64 builds. They install cleanly.

**`systemctl status mindeesai` shows "failed"**

```bash
journalctl -u mindeesai -n 100   # last 100 lines of logs
```

Most common causes:
- `.env.production` syntax error (missing quote, stray space) → fix and `systemctl restart mindeesai`
- Port 3000 already in use → `sudo lsof -i :3000`, kill the offending process
- Out of memory → check `free -h`, raise `MemoryMax` in the systemd unit

**Chat streaming truncates / hangs**

The default nginx config buffers. Confirm `proxy_buffering off` and `proxy_read_timeout 600s` are present in `/etc/nginx/sites-available/mindeesai`. Reload nginx: `sudo systemctl reload nginx`.

**SSL renewal fails**

Certbot's auto-renewal runs twice daily via systemd timer. If you see expiry warnings:

```bash
sudo certbot renew --dry-run
```

Common cause: nginx server_name changed but the cert was issued for the old name. Re-issue with `sudo certbot --nginx -d <correct-name>`.

**VM disk fills up**

```bash
sudo du -sh /var/log/journal   # systemd logs can grow
sudo journalctl --vacuum-time=7d
```

`.next/` and `node_modules/` also fill up — rebuild clears `.next/cache/`. Total project size should stay under 5 GB.

---

## Why this setup is durable

- **No quotas**: Oracle Always Free has no expiry, no usage cap on this shape.
- **No cold starts**: systemd keeps Node hot. First-request latency is single-digit ms.
- **Native module compatibility**: ARM64 binaries exist for every dependency MindeesAI uses today. Future native deps may or may not — but the runtime supports them, unlike Workers.
- **Standard Linux ops**: every problem you hit has decades of Stack Overflow answers. Not a proprietary platform abstraction.
- **Cost: $0/month forever**, as long as you stay within 24 GB / 4 OCPU / 200 GB egress / month. MindeesAI uses ~5% of that egress in normal operation.

The tradeoff is **you own the operations**. SSL renewal, OS patches, log rotation, security hardening, backup strategy — all yours. The trade vs Vercel: more control, more responsibility, zero ongoing cost.

**One annual maintenance task:** Ubuntu 22.04 LTS is supported until 2027. Plan to upgrade to 24.04 LTS or later before then. `sudo do-release-upgrade` handles it.
