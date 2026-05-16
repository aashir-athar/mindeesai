# Training MindeesAI on Kaggle Notebooks + Google Colab

The GitHub Actions cron is your always-on baseline (slow CPU, ~6k steps/day).
Kaggle and Colab are your **leverage** — free GPU access that's 50-100× faster
per step. One 12-hour Kaggle session trains more than a month of GH Actions.

Use them for:
- Heavy training pushes on `home-11gb` (280M params) or `home-max` (349M)
- Catching up after a stretch where local GPU was offline
- Testing new variants before committing to them

Use GH Actions for:
- Always-on continual baseline (never breaks, no human needed)
- Pipeline health check (proves R2 → training → HF flow works daily)
- Public mirror on `small-weekly` revision

---

## Free tier limits (Nov 2025)

| Platform | Compute | Per-session | Per-week | Notes |
|---|---|---|---|---|
| **Kaggle GPU** | P100 16 GB OR T4 ×2 | 12h hard cap | 30h/week | Best free GPU offer in the world |
| **Kaggle TPU** | TPU VM v3-8 | 9h hard cap | 30h/week | PyTorch/XLA needed — more setup |
| **Colab Free** | T4 16 GB | ~12h soft, often < | No formal weekly cap, but Google throttles heavy users | Idle-disconnect after 90 min |
| **Colab Pro** | T4/V100/A100 | Up to 24h | ~$10/month | Skip — paid; use only if Kaggle isn't enough |

**Bottom line:** Kaggle is the right primary, Colab is the backup.

---

## Setup: Kaggle Notebooks

### One-time account setup

1. Create a Kaggle account at `https://kaggle.com` — free, no card needed
2. Phone-verify your account to unlock GPU/TPU access (Settings → Phone verification)
3. Create a HuggingFace **write** token at `https://huggingface.co/settings/tokens`
   — name it `kaggle-mindeesai`, scope: Write to `aashir-athar/mindeesai-base`

### Per-notebook setup

1. New Notebook → Settings (right sidebar):
   - **Accelerator**: GPU T4 ×2 (or P100 — both work, T4 ×2 has more VRAM)
   - **Internet**: ON (needed for HF + dataset downloads)
   - **Persistence**: "Files only" (saves work between sessions)
2. Add Kaggle secret: Add-ons → Secrets → New secret
   - Label: `HF_TOKEN`
   - Value: your HF write token from above

### The notebook (paste these cells in order)

**Cell 1 — Clone repo + install deps:**

```bash
!git clone https://github.com/aashir-athar/mindeesai.git /kaggle/working/mindeesai
%cd /kaggle/working/mindeesai
!pip install -q -r scripts/train/requirements.txt
!pip install -q huggingface_hub
```

**Cell 2 — Pull HF_TOKEN from Kaggle secrets:**

```python
import os
from kaggle_secrets import UserSecretsClient
os.environ["HF_TOKEN"] = UserSecretsClient().get_secret("HF_TOKEN")
os.environ["HUGGING_FACE_HUB_TOKEN"] = os.environ["HF_TOKEN"]
print(f"HF_TOKEN length: {len(os.environ['HF_TOKEN'])} chars")
```

**Cell 3 — Resume from HF (pulls last checkpoint into ./checkpoints/):**

```python
import os
from huggingface_hub import hf_hub_download

REPO = "aashir-athar/mindeesai-base"
REVISION = "small-weekly"   # change to "main" if you want to RESUME the home-11gb main checkpoint instead

os.makedirs("checkpoints", exist_ok=True)
os.makedirs("tokenizer", exist_ok=True)

for filename, local_dir in [
    ("base.bin",        "checkpoints"),
    ("torch-resume.pt", "checkpoints"),
    ("tokenizer.json",  "tokenizer"),
]:
    try:
        p = hf_hub_download(repo_id=REPO, filename=filename, revision=REVISION,
                            local_dir=local_dir, local_dir_use_symlinks=False,
                            token=os.environ["HF_TOKEN"])
        print(f"  ✓ {filename} → {p} ({os.path.getsize(p):,} bytes)")
    except Exception as e:
        msg = str(e).lower()
        if "404" in msg or "not found" in msg or "entry not found" in msg:
            print(f"  · {filename}: not on HF yet (first run) — will train from scratch")
        else:
            print(f"  ✗ {filename}: {e}")
```

**Cell 4 — Run training (this is the cell that takes 8-12 hours):**

```bash
# home-11gb on GPU is the sweet spot — 280M params, fits in 16GB T4/P100 at batch=4
# Push --batch higher if you have headroom (T4 ×2 = 32 GB, can do batch=8)
!python scripts/train/pretrain.py \
    --variant home-11gb \
    --corpus scripts/data/corpus.txt \
    --tokenizer tokenizer/tokenizer.json \
    --steps 200000 \
    --batch 4 \
    --grad-accum 2 \
    --lr 3e-4 \
    --warmup 1000 \
    --wd 0.1 \
    --val-frac 0.05 \
    --val-every 500 \
    --ckpt-every 1000 \
    --base-weight 1.0 \
    --distill-weight 4.0 \
    --completion-only-loss 1 \
    --persona-loss-weight 0.05 \
    --mix-config scripts/data/mix-broadbrain.json \
    --resume checkpoints/torch-resume.pt \
    --amp \
    --grad-ckpt \
    --log data/training-metrics.jsonl \
    --out checkpoints/base.bin \
    --torch-ckpt checkpoints/torch-resume.pt
```

**Cell 5 — Push the trained checkpoint back to HF (CHOOSE YOUR REVISION CAREFULLY):**

```python
from huggingface_hub import HfApi, create_branch

REPO = "aashir-athar/mindeesai-base"

# Where to push depends on what you're doing:
#   "kaggle-weekly"  — recommended; isolated side branch for Kaggle runs.
#                       Doesn't touch your main RTX-trained checkpoint OR
#                       the GH Actions small-weekly branch.
#   "main"           — ONLY if you're sure this Kaggle run is your new
#                       canonical home-11gb checkpoint, replacing your local
#                       RTX training. Most of the time DO NOT do this.
TARGET_REVISION = "kaggle-weekly"

api = HfApi(token=os.environ["HF_TOKEN"])

# Make sure the branch exists (idempotent)
try:
    create_branch(REPO, branch=TARGET_REVISION, exist_ok=True, token=os.environ["HF_TOKEN"])
except Exception as e:
    print(f"create_branch note: {e}")

for local, in_repo in [
    ("checkpoints/base.bin",         "base.bin"),
    ("checkpoints/torch-resume.pt",  "torch-resume.pt"),
    ("tokenizer/tokenizer.json",     "tokenizer.json"),
    ("data/training-metrics.jsonl",  "training-metrics.jsonl"),
]:
    if os.path.exists(local):
        api.upload_file(
            path_or_fileobj=local,
            path_in_repo=in_repo,
            repo_id=REPO,
            revision=TARGET_REVISION,
            commit_message=f"Kaggle training run — {in_repo}",
        )
        print(f"  ✓ uploaded {local} → {REPO}@{TARGET_REVISION}:{in_repo}")
```

### Kaggle session tips

- **Save Version frequently** (Ctrl+S) — disconnects happen
- The 12h cap is strict; your `--ckpt-every 1000` means worst-case loss is ~1k steps
- Kaggle's "Save & Run All" lets you launch the notebook to run unattended in the background — your laptop can sleep, the notebook keeps going
- Free quota resets weekly (every Saturday 00:00 UTC last I checked)

---

## Setup: Google Colab

Colab is more convenient (Google account is enough) but less reliable (idle disconnects, T4 GPU not always available on free tier).

### One-time setup

1. Sign in at `https://colab.research.google.com` with any Google account
2. Same HF token from Kaggle above works here

### The notebook

Identical to Kaggle except:

**Replace Cell 2** with:

```python
import os
from google.colab import userdata
os.environ["HF_TOKEN"] = userdata.get("HF_TOKEN")
os.environ["HUGGING_FACE_HUB_TOKEN"] = os.environ["HF_TOKEN"]
```

You set the secret via the sidebar 🔑 icon → Add new secret → `HF_TOKEN`.

**Replace working directory paths:** Kaggle uses `/kaggle/working/`, Colab uses `/content/`. Change Cell 1's clone target to:

```bash
!git clone https://github.com/aashir-athar/mindeesai.git /content/mindeesai
%cd /content/mindeesai
```

### Colab gotchas

- **Idle timeout: 90 minutes** without browser activity disconnects you. Use a browser-keep-alive extension (Colab Auto-reconnect) or open the tab on a screen that won't sleep.
- **Connection drops mid-training**: when you reconnect, the notebook is paused, not killed. Hit "Reconnect" — your training continues if you used `--resume` and `--ckpt-every`.
- **GPU availability varies**: free tier may put you on a slower GPU (K80) or no GPU at all during peak hours. Run at off-peak (Asia mornings = US night).

---

## Which branch should Kaggle/Colab push to?

This is the most important decision. Three sensible patterns:

### Pattern A — separate `kaggle-weekly` branch (RECOMMENDED, safest)

```
main          ← your local RTX-trained home-11gb / home-max — never touched by CI
small-weekly  ← GH Actions daily cron — cpu_max_5h_50k variant
kaggle-weekly ← Kaggle GPU sessions — home-11gb variant
```

Three independent training pipelines, three independent checkpoints. Compare them, A/B test, no risk of one stomping another.

**Activate one in production**: set `HF_MODEL_REVISION` on Vercel to whichever branch you want the deployed app to use.

### Pattern B — Kaggle pushes to `main` (replacing local training)

Do this **only if** Kaggle becomes your primary heavy-training environment and your local RTX 5070 work moves to a side branch.

### Pattern C — Kaggle pushes to `small-weekly` alongside GH Actions

**Don't.** Mixing GH Actions's tiny `cpu_max_5h_50k` checkpoint with Kaggle's `home-11gb` checkpoint on the same branch creates architecture-mismatch resumes that break training.

---

## Honest comparison: where each platform fits

| Use case | Platform | Why |
|---|---|---|
| Always-on baseline, no human | **GH Actions cron** | Free, automatic, 4× daily, never breaks |
| Heavy training, 1× / week | **Kaggle GPU** | Best free GPU offer; one session = month of CPU |
| Burst training when Kaggle quota is used | **Colab Free** | Same GPU class, no scheduling, idle disconnects |
| Local capacity available | **Your RTX 5070** | Fastest per dollar; you own it; no quotas |
| Frontier-class capability | none of these | Compute gap is multiple orders of magnitude |

**Recommendation:** GH Actions cron (set-and-forget) + Kaggle weekly (the real training run) + local RTX overnights for one-off pushes. Don't bother with Colab unless Kaggle is unavailable.

---

## Troubleshooting

**"CUDA out of memory" during training**
- Drop `--batch` to 2 (or 1) and bump `--grad-accum` to compensate
- Add `--no-grad-ckpt` removal → `--grad-ckpt` is already on in the recipe
- Try the smaller variant: `--variant cpu_max_5h_50k` (works on GPU too, just leaves capacity unused)

**"HuggingFace 401 / 403"**
- Token isn't a Write token, or doesn't have write access to the namespace
- Regenerate at `https://huggingface.co/settings/tokens` with Write scope

**"Notebook timed out / disconnected"**
- Kaggle: ride out the 12h cap, hit Save Version, restart. Resume picks up.
- Colab: the keep-alive trick + run during off-peak hours

**Step time is 5x slower than expected**
- You got a slow GPU slot (Colab K80, or shared T4)
- On Colab: factory-reset the runtime, hope for a better assignment
- On Kaggle: switch from T4 ×2 to P100 (single GPU, often faster per-token)
