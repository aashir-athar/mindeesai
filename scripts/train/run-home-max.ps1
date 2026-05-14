# run-home-max.ps1 — train MindeesAI on a single 12GB consumer GPU.
#
# Tuned for: RTX 5070 (12GB, Blackwell) / RTX 4070 / RTX 4070 Ti
# Also fine on: RTX 3090 / 4090 (24GB) — you can bump --Batch from 4 to 8 or 16.
#
# What this command does:
#   - variant home-max         (~350M params, 16 layers, d_model 1280, MLA + MTP)
#   - bf16 mixed precision     (--amp; Blackwell native bf16, ~2x faster than fp32)
#   - gradient checkpointing   (--grad-ckpt; trade ~30% compute for ~50% less VRAM)
#   - torch.compile            (--compile; ~30% throughput gain after warmup)
#   - 30k steps                (~4-5 hours on RTX 5070)
#   - batch 4 x grad-accum 8   (effective batch 32, safe at 12GB)
#   - completion-only loss     (canonical SFT)
#   - persona-loss regularizer (suppress "as an AI" tokens at the gradient)
#   - distill weight 4x        (live chat corpus dominates the mix)
#   - dialogue:Dolly weight 3x (human conversation structure)
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
    [int]$Batch = 4,
    [int]$GradAccum = 8,
    [switch]$NoCompile  # pass -NoCompile if torch.compile fails on your CUDA/Triton stack
)

# Wrap in try/catch so a double-clicked invocation stays open on error.
try {
    # Working directory should be the repo root
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    Set-Location $repoRoot

    # Activate venv if it exists
    if (Test-Path ".venv\Scripts\Activate.ps1") {
        & ".\.venv\Scripts\Activate.ps1"
        Write-Host "venv activated"
    }

    # ─── CUDA check ───────────────────────────────────────────────────────
    # The python -c outputs ONE line we care about: "CUDA <name> <vram>"
    # or "NO-CUDA". Multi-line array gotcha avoided by joining the output.
    $cudaCheck = (python -c @"
import torch
if torch.cuda.is_available():
    p = torch.cuda.get_device_properties(0)
    print(f'CUDA {torch.cuda.get_device_name(0)} {p.total_memory // 1024**3}GB')
else:
    print('NO-CUDA')
"@ 2>&1) -join "`n"
    Write-Host "GPU: $cudaCheck"
    if ($cudaCheck -notmatch "^CUDA") {
        Write-Host ""
        Write-Host "CUDA is not available. Install CUDA-enabled PyTorch first:" -ForegroundColor Red
        Write-Host "    pip install --index-url https://download.pytorch.org/whl/cu126 torch"
        Write-Host "If pip can't find cu126 wheels for your Python version, try nightly:"
        Write-Host "    pip install --index-url https://download.pytorch.org/whl/nightly/cu126 torch"
        Read-Host "Press Enter to close"
        exit 1
    }

    # Ensure output dirs exist
    New-Item -ItemType Directory -Force -Path "checkpoints" | Out-Null
    New-Item -ItemType Directory -Force -Path "data" | Out-Null

    # Build conditional flag arrays — splatted into python call later.
    $resumeArg = @()
    if ($Resume -and (Test-Path "checkpoints\torch-resume.pt")) {
        $resumeArg = @("--resume", "checkpoints/torch-resume.pt")
        Write-Host "RESUMING from checkpoints\torch-resume.pt"
    }

    $distillArg = @()
    if ((Test-Path "data\distill-corpus.jsonl") -and ((Get-Item "data\distill-corpus.jsonl").Length -gt 0)) {
        $size = (Get-Item "data\distill-corpus.jsonl").Length
        $distillArg = @("--distill-corpus", "data/distill-corpus.jsonl")
        Write-Host "DISTILL CORPUS: data/distill-corpus.jsonl ($size bytes)"
    }

    $compileArg = @()
    if (-not $NoCompile) {
        $compileArg = @("--compile")
    }

    $effective = $Batch * $GradAccum

    Write-Host ""
    Write-Host "--- Launching MindeesAI home-max training ---" -ForegroundColor Cyan
    Write-Host "  variant:        $Variant"
    Write-Host "  steps:          $Steps"
    Write-Host "  batch:          $Batch (x grad_accum $GradAccum = effective $effective)"
    Write-Host "  precision:      bf16 autocast (--amp)"
    Write-Host "  grad-ckpt:      ENABLED"
    Write-Host "  torch.compile:  $(if ($NoCompile) {'DISABLED (-NoCompile)'} else {'ENABLED'})"
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
        --amp `
        --grad-ckpt `
        --log data/training-metrics.jsonl `
        --out checkpoints/base.bin `
        --torch-ckpt checkpoints/torch-resume.pt `
        @compileArg @resumeArg @distillArg

    $pyExit = $LASTEXITCODE
    if ($pyExit -ne 0) {
        Write-Host ""
        Write-Host "pretrain.py exited with code $pyExit" -ForegroundColor Yellow
        Read-Host "Press Enter to close"
        exit $pyExit
    }

    Write-Host ""
    Write-Host "--- Training complete ---" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next:"
    Write-Host "  1. Set the Blob token (one-time per shell):"
    Write-Host "       `$env:BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_...'"
    Write-Host "  2. Upload to Vercel:"
    Write-Host "       python scripts/upload_checkpoint.py"
    Write-Host "  3. Visit any page on the deployed site to trigger a cold start"
    Write-Host "  4. Open /admin and flip USE_NATIVE_MODEL ON"
    Write-Host "  5. Your next chat runs on YOUR weights."
}
catch {
    Write-Host ""
    Write-Host "FATAL: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
