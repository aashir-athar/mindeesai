/**
 * BPE training (a.k.a. "fit the vocabulary on a corpus").
 *
 * Algorithm:
 *  1. Start with a per-byte alphabet (256 symbols) + reserved special tokens.
 *  2. Scan the corpus, count adjacent-pair frequencies.
 *  3. Pop the most frequent pair, merge it into a new token, append to vocab.
 *  4. Repeat until vocab reaches the target size.
 *
 * For scale (≥ 1GB corpora), prefer the Python implementation at
 * `scripts/train/tokenizer_train.py` — same algorithm, 50× faster with C ext.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { SPECIAL_TOKEN_NAMES, bytesToBase64 } from "./bpe";

const TEXT_ENCODER = new TextEncoder();

export async function trainBpe(opts: {
  corpus: string | string[]; // raw text(s)
  vocabSize: number;
  outDir: string;
  minPairFreq?: number;
}): Promise<{ vocab: string[]; merges: Array<[number, number, number]> }> {
  const texts = Array.isArray(opts.corpus) ? opts.corpus : [opts.corpus];
  const target = opts.vocabSize;
  const minFreq = opts.minPairFreq ?? 2;

  // Seed vocab: specials + every byte (0..255)
  const vocab: Uint8Array[] = [];
  for (const _ of SPECIAL_TOKEN_NAMES) vocab.push(new Uint8Array(0)); // specials have no bytes
  for (let b = 0; b < 256; b++) vocab.push(new Uint8Array([b]));

  const merges: Array<[number, number, number]> = [];

  // Pre-tokenize each text into id-sequence of bytes
  const sequences: number[][] = [];
  for (const t of texts) {
    const bytes = TEXT_ENCODER.encode(t);
    const ids: number[] = [];
    for (const b of bytes) ids.push(SPECIAL_TOKEN_NAMES.length + b);
    sequences.push(ids);
  }

  while (vocab.length < target) {
    // Count pair frequencies across all sequences
    const pairCounts = new Map<number, number>();
    for (const seq of sequences) {
      for (let i = 0; i < seq.length - 1; i++) {
        const key = seq[i]! * 1_000_000 + seq[i + 1]!;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }

    // Pick the most frequent pair
    let bestKey = -1;
    let bestCount = 0;
    for (const [k, c] of pairCounts) {
      if (c > bestCount) {
        bestKey = k;
        bestCount = c;
      }
    }
    if (bestKey < 0 || bestCount < minFreq) break;

    const left = Math.floor(bestKey / 1_000_000);
    const right = bestKey % 1_000_000;
    const mergedBytes = concatBytes(vocab[left]!, vocab[right]!);
    const newId = vocab.length;
    vocab.push(mergedBytes);
    merges.push([left, right, newId]);

    // Apply the merge to every sequence (greedy single-pass)
    for (const seq of sequences) {
      let i = 0;
      while (i < seq.length - 1) {
        if (seq[i] === left && seq[i + 1] === right) {
          seq.splice(i, 2, newId);
        } else {
          i++;
        }
      }
    }
  }

  // Serialize
  await mkdir(opts.outDir, { recursive: true });
  const serialized = {
    vocab: vocab.map((b) => bytesToBase64(b)),
    merges,
  };
  await writeFile(path.join(opts.outDir, "tokenizer.json"), JSON.stringify(serialized), "utf8");
  return serialized;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
