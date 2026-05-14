#!/usr/bin/env python3
"""
Upload a locally-trained checkpoint to Vercel Blob so the deployed app
hydrates the new weights on its next cold start.

Usage:
  # Set your Blob R/W token once (find it in Vercel → Storage → your-blob-store)
  export BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
  # PowerShell:
  $env:BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_..."

  python scripts/upload_checkpoint.py
  # → uploads checkpoints/base.bin + tokenizer/tokenizer.json + data/training-metrics.jsonl
  # → to blob paths that match the in-app hydrate map

  # Or specify a single file:
  python scripts/upload_checkpoint.py checkpoints/base.bin

The in-app hydrate (lib/memory/persistence.ts) maps blob prefixes:
   checkpoints/  → CHECKPOINTS_DIR (= /tmp/checkpoints on Vercel)
   data/         → DATA_DIR        (= /tmp/data        on Vercel)
   lancedb/      → LANCEDB_PATH    (= /tmp/lancedb     on Vercel)

So checkpoint goes to blob path `checkpoints/base.bin` — exactly where
core/mindees-mind/index.ts loadNativeCheckpoint() reads from after cold-
start hydrate fires. Flip USE_NATIVE_MODEL on /admin and you're running
on your own weights with zero Groq dependency.
"""
from __future__ import annotations

import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

DEFAULT_TARGETS: list[tuple[str, str]] = [
    # (local_path, blob_path)
    ("checkpoints/base.bin",        "checkpoints/base.bin"),
    ("tokenizer/tokenizer.json",    "data/tokenizer.json"),
    ("data/training-metrics.jsonl", "data/training-metrics.jsonl"),
]


def upload_one(local: str, blob_path: str, token: str) -> bool:
    p = Path(local)
    if not p.exists():
        print(f"  skip {local} — not on disk")
        return False
    body = p.read_bytes()
    size_mb = len(body) / 1024 / 1024
    print(f"  uploading {local} ({size_mb:.1f} MB) → blob:{blob_path} ...", end=" ", flush=True)
    req = urllib.request.Request(
        f"https://blob.vercel-storage.com/{blob_path}",
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "x-content-type": "application/octet-stream",
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            print(f"OK ({resp.status})")
            return True
    except urllib.error.HTTPError as e:
        print(f"FAIL {e.code} {e.reason}")
        body_msg = e.read().decode(errors="replace") if hasattr(e, "read") else ""
        if body_msg:
            print(f"    server said: {body_msg[:300]}")
        return False
    except Exception as e:
        print(f"FAIL {e}")
        return False


def main() -> int:
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
    if not token:
        print("✗ BLOB_READ_WRITE_TOKEN not set in the environment.")
        print()
        print("  Find your token at:")
        print("    Vercel dashboard → your project → Storage → click your Blob store → '.env.local' tab")
        print()
        print("  Then set it (one-time per shell):")
        print("    PowerShell:  $env:BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_...'")
        print("    Bash/zsh:    export BLOB_READ_WRITE_TOKEN='vercel_blob_rw_...'")
        return 2

    # CLI form: `upload_checkpoint.py path/to/file.bin [blob_path]`
    if len(sys.argv) >= 2:
        local = sys.argv[1]
        blob_path = sys.argv[2] if len(sys.argv) >= 3 else f"checkpoints/{Path(local).name}"
        ok = upload_one(local, blob_path, token)
        return 0 if ok else 1

    # Default: upload the canonical training-output triple
    print(f"Uploading {len(DEFAULT_TARGETS)} files to Vercel Blob...")
    n_ok = 0
    for local, blob_path in DEFAULT_TARGETS:
        if upload_one(local, blob_path, token):
            n_ok += 1

    print()
    print(f"Done — {n_ok}/{len(DEFAULT_TARGETS)} uploaded.")
    if n_ok > 0:
        print()
        print("Next steps:")
        print("  1. Trigger any cold-start (visit /chat or /api/health)")
        print("  2. Check /api/inference-mode — `checkpoint_present` should now be true")
        print("  3. Open /admin and flip USE_NATIVE_MODEL on")
        print("  4. Your next chat message routes through your trained weights")
    return 0 if n_ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
