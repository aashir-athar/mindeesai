#!/usr/bin/env python3
"""
Upload a locally-trained checkpoint to HuggingFace Hub so the deployed
Vercel app fetches the new weights on its next cold start.

Why HF instead of Vercel Blob:
  - Unlimited free storage for public model repos
  - No write-quota cliff (Hobby Blob caps at 2k writes/mo)
  - $0 egress on downloads (Vercel cold-starts pull free)
  - Git-LFS-backed versioning of every checkpoint

The deployed runtime reads from this exact path on cold start:
  https://huggingface.co/<HF_MODEL_REPO>/resolve/<HF_MODEL_REVISION>/<HF_MODEL_FILE>
which `core/mindees-mind/model/hf-download.ts` calls and caches to
`/tmp/checkpoints/base.bin`. After upload, just trigger any cold-start
(visit /chat or /api/health) and the next request runs on your trained
weights.

Setup (one time):
  pip install huggingface_hub
  huggingface-cli login          # uses your HF token; cached in ~/.huggingface

Usage:
  python scripts/upload_to_hf.py
  # → uploads checkpoints/base.bin (and tokenizer + metrics if present)
  # → to aashir-athar/mindeesai-base

  # Or specify a custom local file / target name:
  python scripts/upload_to_hf.py checkpoints/base.bin base.bin

  # Or pin to a specific revision (creates the repo if needed):
  python scripts/upload_to_hf.py --repo aashir-athar/mindeesai-base
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DEFAULT_REPO = "aashir-athar/mindeesai-base"

DEFAULT_TARGETS: list[tuple[str, str]] = [
    # (local_path, repo_path)
    ("checkpoints/base.bin",         "base.bin"),
    ("tokenizer/tokenizer.json",     "tokenizer.json"),
    ("data/training-metrics.jsonl",  "training-metrics.jsonl"),
]


def upload_one(api, local: str, repo_path: str, repo_id: str, repo_type: str = "model") -> bool:
    p = Path(local)
    if not p.exists():
        print(f"  skip {local} — not on disk")
        return False
    size_mb = p.stat().st_size / 1024 / 1024
    print(f"  uploading {local} ({size_mb:.1f} MB) → {repo_id}:{repo_path} …", end=" ", flush=True)
    try:
        api.upload_file(
            path_or_fileobj=str(p),
            path_in_repo=repo_path,
            repo_id=repo_id,
            repo_type=repo_type,
            commit_message=f"upload {repo_path} ({size_mb:.1f} MB)",
        )
        print("OK")
        return True
    except Exception as e:
        print(f"FAIL {e}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload MindeesAI checkpoint to HuggingFace Hub.")
    parser.add_argument("local", nargs="?", help="Local file to upload (default: full triple)")
    parser.add_argument("repo_path", nargs="?", help="Path inside the HF repo (default: same name)")
    parser.add_argument("--repo", default=os.environ.get("HF_MODEL_REPO", DEFAULT_REPO),
                        help=f"HuggingFace repo (default: {DEFAULT_REPO} or $HF_MODEL_REPO)")
    parser.add_argument("--private", action="store_true",
                        help="Create the repo as private (default: public, unlimited free storage)")
    args = parser.parse_args()

    try:
        from huggingface_hub import HfApi, create_repo
    except ImportError:
        print("✗ huggingface_hub not installed.")
        print()
        print("  Install:")
        print("    pip install huggingface_hub")
        print()
        print("  Then authenticate (one-time, opens browser):")
        print("    huggingface-cli login")
        return 2

    token = os.environ.get("HF_TOKEN") or None  # falls back to cached login
    api = HfApi(token=token)

    # Make sure the repo exists. exist_ok=True means this is idempotent —
    # safe to call on every upload.
    try:
        create_repo(args.repo, repo_type="model", exist_ok=True, private=args.private, token=token)
    except Exception as e:
        print(f"✗ Could not create or verify repo {args.repo}: {e}")
        print("  - Are you logged in?  Run: huggingface-cli login")
        print("  - Does your account have write access to that namespace?")
        return 3

    # Single-file form: `upload_to_hf.py path/to/file.bin [repo_path]`
    if args.local:
        repo_path = args.repo_path or Path(args.local).name
        ok = upload_one(api, args.local, repo_path, args.repo)
        return 0 if ok else 1

    # Default: upload the canonical training-output triple
    print(f"Uploading {len(DEFAULT_TARGETS)} files to {args.repo} on HuggingFace Hub…")
    n_ok = 0
    for local, repo_path in DEFAULT_TARGETS:
        if upload_one(api, local, repo_path, args.repo):
            n_ok += 1

    print()
    print(f"Done — {n_ok}/{len(DEFAULT_TARGETS)} uploaded.")
    if n_ok > 0:
        print()
        print("Next steps:")
        print(f"  1. Verify the model card at: https://huggingface.co/{args.repo}")
        print( "  2. Trigger a cold-start on Vercel (visit /chat or /api/health)")
        print( "  3. Check /api/inference-mode — checkpoint_present should now be true")
        print( "  4. Open /admin and flip USE_NATIVE_MODEL on")
        print( "  5. The next chat message routes through your trained weights")
    return 0 if n_ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
