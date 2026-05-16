#!/usr/bin/env bash
# run-home-max.sh — train MindeesAI on a single 12GB consumer GPU.
#
# Tuned for: RTX 5070 (12GB, Blackwell) / RTX 4070 / RTX 4070 Ti
# Also fine on: RTX 3090 / 4090 (24GB) — bump --batch from 4 to 8 or 16.
#
# Usage:
#   bash scripts/train/run-home-max.sh [options]
#
# Options:
#   --resume          Resume from checkpoints/torch-resume.pt
#   --no-compile      Disable torch.compile
#   --no-grad-ckpt    Disable gradient checkpointing (use if backward crashes)
#   --variant VAR       Model variant (default: home-max)
#   --steps N           Training steps (default: 50000)
#   --batch N           Batch size (default: 4)
#   --grad-accum N      Gradient accumulation steps (default: 8)
#   --hf-token TOKEN    HuggingFace token for faster/private dataset downloads
#   --mix-config PATH   JSON recipe describing extra HF datasets (see
#                       scripts/data/mix-broadbrain.json). Adds N data
#                       streams on TOP of the default dialogue + hf-stream
#                       pair. Empty by default — backward compatible.

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
RESUME=0
NO_COMPILE=0
NO_GRAD_CKPT=0
VARIANT="home-max"
STEPS=50000
BATCH=4
GRAD_ACCUM=8
HF_TOKEN="${HF_TOKEN:-}"  # Can be pre-set in environment or passed as --hf-token
MIX_CONFIG=""

# ─── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --resume)       RESUME=1 ;;
        --no-compile)   NO_COMPILE=1 ;;
        --no-grad-ckpt) NO_GRAD_CKPT=1 ;;
        --variant)      VARIANT="$2"; shift ;;
        --steps)        STEPS="$2"; shift ;;
        --batch)        BATCH="$2"; shift ;;
        --grad-accum)   GRAD_ACCUM="$2"; shift ;;
        --hf-token)     HF_TOKEN="$2"; shift ;;
        --mix-config)   MIX_CONFIG="$2"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

# ─── Repo root (two levels up from this script) ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ─── Activate venv if present ─────────────────────────────────────────────────
if [[ -f ".venv/bin/activate" ]]; then
    source ".venv/bin/activate"
    echo "venv activated"
fi

# ─── HuggingFace token ────────────────────────────────────────────────────────
if [[ -n "$HF_TOKEN" ]]; then
    export HF_TOKEN="$HF_TOKEN"
    export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"   # legacy env var some libs use
    echo "HF_TOKEN: set (faster dataset downloads enabled)"
else
    echo "HF_TOKEN: not set (unauthenticated, rate-limited downloads)"
    echo "  Tip: run with --hf-token hf_xxx  OR  export HF_TOKEN=hf_xxx before this script"
fi

# ─── CUDA memory allocator ────────────────────────────────────────────────────
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# ─── CUDA check ───────────────────────────────────────────────────────────────
CUDA_CHECK=$(python3 -c "
import torch
if torch.cuda.is_available():
    p = torch.cuda.get_device_properties(0)
    cc = torch.cuda.get_device_capability(0)
    print(f'CUDA {torch.cuda.get_device_name(0)} {p.total_memory // 1024**3}GB  sm_{cc[0]}{cc[1]}')
else:
    print('NO-CUDA')
" 2>&1 || true)

echo "GPU: $CUDA_CHECK"

if [[ "$CUDA_CHECK" != CUDA* ]]; then
    echo ""
    echo "ERROR: CUDA is not available. Install CUDA-enabled PyTorch:" >&2
    echo "  pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128" >&2
    exit 1
fi

# ─── Ensure output dirs exist ─────────────────────────────────────────────────
mkdir -p checkpoints data

# ─── Build optional flag arrays ───────────────────────────────────────────────
RESUME_ARGS=()
if [[ $RESUME -eq 1 && -f "checkpoints/torch-resume.pt" ]]; then
    RESUME_ARGS=("--resume" "checkpoints/torch-resume.pt")
    echo "RESUMING from checkpoints/torch-resume.pt"
fi

DISTILL_ARGS=()
if [[ -f "data/distill-corpus.jsonl" && -s "data/distill-corpus.jsonl" ]]; then
    SIZE=$(wc -c < "data/distill-corpus.jsonl")
    DISTILL_ARGS=("--distill-corpus" "data/distill-corpus.jsonl")
    echo "DISTILL CORPUS: data/distill-corpus.jsonl ($SIZE bytes)"
fi

COMPILE_ARGS=()
if [[ $NO_COMPILE -eq 0 ]]; then
    COMPILE_ARGS=("--compile")
fi

GRAD_CKPT_ARGS=()
if [[ $NO_GRAD_CKPT -eq 0 ]]; then
    GRAD_CKPT_ARGS=("--grad-ckpt")
fi

MIX_ARGS=()
if [[ -n "$MIX_CONFIG" ]]; then
    if [[ ! -f "$MIX_CONFIG" ]]; then
        echo "ERROR: --mix-config file not found: $MIX_CONFIG" >&2
        exit 1
    fi
    MIX_ARGS=("--mix-config" "$MIX_CONFIG")
fi

EFFECTIVE=$(( BATCH * GRAD_ACCUM ))

echo ""
echo "--- Launching MindeesAI training ---"
echo "  variant:        $VARIANT"
echo "  steps:          $STEPS"
echo "  batch:          $BATCH (x grad_accum $GRAD_ACCUM = effective $EFFECTIVE)"
echo "  precision:      fp16 autocast (--amp)"
echo "  grad-ckpt:      $([ $NO_GRAD_CKPT -eq 1 ] && echo 'DISABLED (--no-grad-ckpt)' || echo 'ENABLED')"
echo "  torch.compile:  $([ $NO_COMPILE -eq 1 ] && echo 'DISABLED (--no-compile)' || echo 'ENABLED')"
echo "  mix-config:     $([ -n "$MIX_CONFIG" ] && echo "$MIX_CONFIG" || echo '(none — using default 2-dataset mix)')"
echo ""

# ─── Launch training ──────────────────────────────────────────────────────────
python3 scripts/train/pretrain.py \
    --variant "$VARIANT" \
    --corpus scripts/data/corpus.txt \
    --tokenizer tokenizer/tokenizer.json \
    --steps "$STEPS" \
    --batch "$BATCH" \
    --grad-accum "$GRAD_ACCUM" \
    --lr 3e-4 \
    --warmup 1000 \
    --wd 0.1 \
    --val-frac 0.05 \
    --val-every 500 \
    --ckpt-every 2000 \
    --base-weight 1.0 \
    --distill-weight 4.0 \
    --dialogue-dataset databricks/databricks-dolly-15k \
    --dialogue-weight 3.0 \
    --dialogue-max-tokens 1500000 \
    --hf-dataset roneneldan/TinyStories \
    --hf-weight 1.5 \
    --hf-max-tokens 500000 \
    --amp \
    --log data/training-metrics.jsonl \
    --out checkpoints/base.bin \
    --torch-ckpt checkpoints/torch-resume.pt \
    "${GRAD_CKPT_ARGS[@]}" \
    "${COMPILE_ARGS[@]}" \
    "${MIX_ARGS[@]}" \
    "${RESUME_ARGS[@]}" \
    "${DISTILL_ARGS[@]}"

echo ""
echo "--- Training complete ---"
echo ""
echo "Checkpoints saved locally:"
echo "  checkpoints/base.bin          <- model weights"
echo "  checkpoints/torch-resume.pt   <- resume checkpoint"
echo "  data/training-metrics.jsonl   <- loss/val logs"
echo ""
echo "When ready to publish the trained model to HuggingFace Hub:"
echo "  pip install huggingface_hub"
echo "  huggingface-cli login            # one-time, opens browser, cached in ~/.huggingface"
echo "  python scripts/upload_to_hf.py   # pushes base.bin + tokenizer + metrics to HF"
echo ""
echo "After upload, the deployed Vercel app fetches base.bin from HF on next"
echo "cold start (see core/mindees-mind/model/hf-download.ts). Verify via:"
echo "  curl https://<your-project>.vercel.app/api/inference-mode"
echo "  -> 'checkpoint_present' should be true after the first cold start."