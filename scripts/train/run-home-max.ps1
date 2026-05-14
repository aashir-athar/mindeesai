# run-home-max.ps1 — train MindeesAI on a single 12GB consumer GPU.
#
# Tuned for: RTX 5070 (12GB, Blackwell) / RTX 4070 / RTX 4070 Ti / RTX 4080
# Also fine on: RTX 3090 (24GB) — you can bump --batch from 8 to 16.
#
# What this command actually does:
#   - variant home-max         (~280M params, 16 layers, d_model 1280)
#   - bf16 mixed precision     (--amp; Blackwell native bf16, ~2× faster than fp32)
#   - gradient checkpointing   (--grad-ckpt; trade compute for VRAM)
#   - torch.compile            (--compile; ~30% throughput gain after warmup)
#   - 30k steps                (~3-4 hours overnight on RTX 5070)
#   - batch 8 × grad-accum 4   (effective batch 32, fits 12GB)
#   - completion-only loss     (canonical SFT)
#   - persona-loss regularizer (suppress "as an AI" tokens at the gradient)
#   - distill weight 4×        (live chat corpus dominates the mix)
#   - dialogue:Dolly weight 3× (human conversation structure)
#   - HF augmentation: TinyStories (narrative warmup, +500k tokens)
#
# Resume after a crash:
#   .\scripts\train\run-home-max.ps1 -Resume
#
# After training completes, push to Vercel Blob:
#   $env:BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_..."
#   python scripts/upload_checkpoint.py

param(
    [switch]$Resume,
    [string]$Variant = "home-max",
    [int]$Steps = 30000,
    [int]$Batch = 8,
    [int]$GradAccum = 4
)

$ErrorActionPreference = "Stop"

# Working directory should be the repo root
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

# Activate venv if it exists
if (Test-Path ".venv\Scripts\Activate.ps1") {
    & ".\.venv\Scripts\Activate.ps1"
}

# Verify CUDA is reachable before we burn three hours
$cudaCheck = python -c "import torch; print('CUDA' if torch.cuda.is_available() else 'NO-CUDA'); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" 2>&1
Write-Host "CUDA check: $cudaCheck"
if ($cudaCheck -notmatch "^CUDA") {
    Write-Host ""
    Write-Host "✗ CUDA is not available. Install CUDA-enabled PyTorch first:" -ForegroundColor Red
    Write-Host "    pip install --index-url https://download.pytorch.org/whl/cu126 torch"
    exit 1
}

# Ensure output dirs exist
New-Item -ItemType Directory -Force -Path "checkpoints" | Out-Null
New-Item -ItemType Directory -Force -Path "data" | Out-Null

$resumeArg = @()
if ($Resume -and (Test-Path "checkpoints/torch-resume.pt")) {
    $resumeArg = @("--resume", "checkpoints/torch-resume.pt")
    Write-Host "RESUMING from checkpoints/torch-resume.pt"
}

# Distill corpus is optional — only included if the file is non-empty
$distillArg = @()
if ((Test-Path "data/distill-corpus.jsonl") -and ((Get-Item "data/distill-corpus.jsonl").Length -gt 0)) {
    $distillArg = @("--distill-corpus", "data/distill-corpus.jsonl")
    Write-Host "DISTILL CORPUS: data/distill-corpus.jsonl ($((Get-Item "data/distill-corpus.jsonl").Length) bytes)"
}

Write-Host ""
Write-Host "─── Launching MindeesAI home-max training ───────────────────────" -ForegroundColor Cyan
Write-Host "  variant:        $Variant"
Write-Host "  steps:          $Steps"
Write-Host "  batch:          $Batch (× grad_accum $GradAccum = effective $($Batch * $GradAccum))"
Write-Host "  precision:      bf16 autocast (--amp)"
Write-Host "  grad-ckpt:      ENABLED"
Write-Host "  torch.compile:  ENABLED"
Write-Host ""

python scripts/train/pretrain.py `
    --variant $Variant `
    --corpus scripts/data/corpus.txt `
    --tokenizer tokenizer/tokenizer.json `
    --steps $Steps `
    --batch $Batch `
    --grad-accum $GradAccum `
    --lr 3e-4 `
    --warmup 1000 `
    --wd 0.1 `
    --val-frac 0.05 `
    --val-every 500 `
    --ckpt-every 2000 `
    --base-weight 1.0 `
    --distill-weight 4.0 `
    --dialogue-dataset databricks/databricks-dolly-15k `
    --dialogue-weight 3.0 `
    --dialogue-max-tokens 1500000 `
    --hf-dataset roneneldan/TinyStories `
    --hf-weight 1.5 `
    --hf-max-tokens 500000 `
    --completion-only-loss 1 `
    --persona-loss-weight 0.05 `
    --mtp-loss-weight 0.20 `
    --amp `
    --grad-ckpt `
    --compile `
    --log data/training-metrics.jsonl `
    --out checkpoints/base.bin `
    --torch-ckpt checkpoints/torch-resume.pt `
    @resumeArg @distillArg

Write-Host ""
Write-Host "─── Training complete ────────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Set the Blob token (one-time per shell):"
Write-Host "       `$env:BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_...'"
Write-Host "  2. Upload to Vercel:"
Write-Host "       python scripts/upload_checkpoint.py"
Write-Host "  3. Visit any page on the deployed site to trigger a cold start"
Write-Host "  4. Open /admin → flip USE_NATIVE_MODEL ON"
Write-Host "  5. Your next chat runs on YOUR weights."
