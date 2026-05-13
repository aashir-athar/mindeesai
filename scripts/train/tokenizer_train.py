#!/usr/bin/env python3
"""
Train a byte-level BPE tokenizer compatible with the TypeScript runtime in
`core/mindees-mind/tokenizer/bpe.ts`.

The output JSON layout matches what `loadTokenizer()` expects:
  {
    "vocab":  ["<base64 bytes>", ...],
    "merges": [[left_id, right_id, merged_id], ...]
  }

Special tokens (in this fixed order) occupy IDs 0..7:
  <bos>, <eos>, <pad>, <user>, <assistant>, <tool>, <think>, </think>
Bytes 0..255 occupy IDs 8..263.
Merged tokens begin at ID 264 and go up to vocab_size − 1.
"""

import argparse
import base64
import json
import os
import sys
from collections import Counter
from pathlib import Path

SPECIAL_TOKENS = ["<bos>", "<eos>", "<pad>", "<user>", "<assistant>", "<tool>", "<think>", "</think>"]
FIRST_BYTE_ID = len(SPECIAL_TOKENS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True, help="Path to plain-text corpus")
    ap.add_argument("--vocab-size", type=int, default=32000)
    ap.add_argument("--min-pair-freq", type=int, default=2)
    ap.add_argument("--out", required=True, help="Path to write tokenizer.json")
    args = ap.parse_args()

    corpus_text = Path(args.corpus).read_text(encoding="utf-8", errors="replace")
    if not corpus_text:
        print("empty corpus", file=sys.stderr)
        sys.exit(1)

    # Seed vocab: specials + bytes
    vocab: list[bytes] = [b""] * len(SPECIAL_TOKENS)
    for b in range(256):
        vocab.append(bytes([b]))

    # Pre-tokenize: corpus → list of (id-sequence) per document.
    # We split on newlines to keep memory manageable and per-doc pair counts independent.
    sequences: list[list[int]] = []
    for line in corpus_text.split("\n"):
        if not line:
            continue
        ids = [FIRST_BYTE_ID + b for b in line.encode("utf-8")]
        sequences.append(ids)

    target = args.vocab_size
    pair_counts: Counter[tuple[int, int]] = Counter()

    def recount_pairs():
        pair_counts.clear()
        for seq in sequences:
            for i in range(len(seq) - 1):
                pair_counts[(seq[i], seq[i + 1])] += 1

    recount_pairs()
    merges: list[tuple[int, int, int]] = []

    while len(vocab) < target and pair_counts:
        (left, right), count = pair_counts.most_common(1)[0]
        if count < args.min_pair_freq:
            break
        merged_id = len(vocab)
        vocab.append(vocab[left] + vocab[right])
        merges.append((left, right, merged_id))

        # Apply the merge to every sequence
        for seq in sequences:
            i = 0
            while i < len(seq) - 1:
                if seq[i] == left and seq[i + 1] == right:
                    seq[i : i + 2] = [merged_id]
                else:
                    i += 1

        # Recount (could be incremental but O(N) is fine for our scale)
        recount_pairs()

        if len(vocab) % 500 == 0:
            print(f"  vocab={len(vocab)} last_merge_count={count}", file=sys.stderr)

    out = {
        "vocab": [base64.b64encode(b).decode("ascii") for b in vocab],
        "merges": [list(m) for m in merges],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {args.out}  vocab_size={len(vocab)}  merges={len(merges)}")


if __name__ == "__main__":
    main()
