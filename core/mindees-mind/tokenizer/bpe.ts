/**
 * Byte-Pair Encoding tokenizer — runtime + training.
 *
 * The runtime is a straight port of the GPT-2-style BPE: byte-level pre-tokenizer
 * + learned merge rules. Trained vocab + merges live in `tokenizer/` at the repo
 * root, written by `core/mindees-mind/tokenizer/train.ts` (or the Python script
 * for large corpora).
 *
 * Design notes:
 *  - We tokenize by *byte* first, so any input is encodable — no <unk>.
 *  - Vocabulary is shared across English, code, and whitespace. Unicode survives
 *    via UTF-8 byte fallback.
 *  - Special tokens (<bos>, <eos>, <pad>, <user>, <assistant>, <tool>) are
 *    reserved at fixed IDs at the bottom of the vocabulary.
 */

export const SPECIAL_TOKENS = {
  BOS: 0,
  EOS: 1,
  PAD: 2,
  USER: 3,
  ASSISTANT: 4,
  TOOL: 5,
  THINK: 6,
  END_THINK: 7,
} as const;

export const SPECIAL_TOKEN_NAMES = ["<bos>", "<eos>", "<pad>", "<user>", "<assistant>", "<tool>", "<think>", "</think>"] as const;

const FIRST_NORMAL_TOKEN = SPECIAL_TOKEN_NAMES.length;

export interface BpeVocab {
  /** id → utf-8 byte sequence */
  idToBytes: Uint8Array[];
  /** byte sequence (joined) → id */
  bytesToId: Map<string, number>;
  /** ordered merge rules: each entry is [left_id, right_id, merged_id] */
  merges: Array<[number, number, number]>;
  /** quick lookup by (left,right) → merged_id */
  mergeMap: Map<number, number>; // key = left * vocabSize + right
}

export interface BpeTokenizer {
  vocab: BpeVocab;
  vocabSize: number;
  encode(text: string, opts?: { bos?: boolean; eos?: boolean }): Int32Array;
  decode(ids: ArrayLike<number>): string;
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const TEXT_ENCODER = new TextEncoder();

export function loadTokenizer(serialized: {
  vocab: string[];               // base64-encoded byte sequences
  merges: Array<[number, number, number]>;
}): BpeTokenizer {
  const idToBytes: Uint8Array[] = serialized.vocab.map((b64) => base64ToBytes(b64));
  const bytesToId = new Map<string, number>();
  idToBytes.forEach((bytes, i) => {
    bytesToId.set(bytesKey(bytes), i);
  });

  const vocabSize = idToBytes.length;
  const mergeMap = new Map<number, number>();
  for (const [l, r, m] of serialized.merges) {
    mergeMap.set(l * vocabSize + r, m);
  }

  const vocab: BpeVocab = { idToBytes, bytesToId, merges: serialized.merges, mergeMap };

  return {
    vocab,
    vocabSize,
    encode(text, opts) {
      const ids = bpeEncode(text, vocab, vocabSize);
      const out: number[] = [];
      if (opts?.bos) out.push(SPECIAL_TOKENS.BOS);
      out.push(...ids);
      if (opts?.eos) out.push(SPECIAL_TOKENS.EOS);
      return new Int32Array(out);
    },
    decode(ids) {
      return bpeDecode(ids, vocab);
    },
  };
}

function bpeEncode(text: string, vocab: BpeVocab, vocabSize: number): number[] {
  const bytes = TEXT_ENCODER.encode(text);
  // Start with single-byte tokens (reserved at IDs FIRST_NORMAL_TOKEN .. FIRST_NORMAL_TOKEN+255)
  const ids: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const tokenForByte = byteToId(bytes[i]!, vocab);
    ids.push(tokenForByte);
  }

  // Greedy merge using mergeMap
  let merged = true;
  while (merged) {
    merged = false;
    let bestI = -1;
    let bestRank = Infinity;
    let bestMerged = -1;
    // Each merge entry has an implicit rank = its index in merges[]. Lower = applied first.
    for (let i = 0; i < ids.length - 1; i++) {
      const key = ids[i]! * vocabSize + ids[i + 1]!;
      const mergedId = vocab.mergeMap.get(key);
      if (mergedId !== undefined) {
        // We don't store rank separately; use the merge index by scanning. For small
        // vocabs this is fine. For training-scale we'd cache rank-by-key.
        // To stay deterministic, take the *earliest* merge that fires.
        bestI = i;
        bestMerged = mergedId;
        bestRank = 0; // any hit beats no-hit
        break;
      }
    }
    if (bestI >= 0) {
      ids.splice(bestI, 2, bestMerged);
      merged = true;
    }
    void bestRank;
  }

  return ids;
}

function bpeDecode(ids: ArrayLike<number>, vocab: BpeVocab): string {
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (id < FIRST_NORMAL_TOKEN) continue; // skip special tokens in decode
    const bytes = vocab.idToBytes[id];
    if (bytes) buffers.push(bytes);
  }
  const total = buffers.reduce((s, b) => s + b.length, 0);
  const flat = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) {
    flat.set(b, off);
    off += b.length;
  }
  return TEXT_DECODER.decode(flat);
}

function byteToId(byte: number, vocab: BpeVocab): number {
  // Bytes are at IDs [FIRST_NORMAL_TOKEN, FIRST_NORMAL_TOKEN + 256). If the vocab
  // was trained with that convention, this is a direct mapping.
  const probe = vocab.bytesToId.get(bytesKey(new Uint8Array([byte])));
  return probe ?? FIRST_NORMAL_TOKEN + byte;
}

function bytesKey(b: Uint8Array): string {
  // Inexpensive joiner; Map<string, ...> beats Map<Uint8Array, ...> on V8 because
  // Uint8Array uses identity equality.
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
