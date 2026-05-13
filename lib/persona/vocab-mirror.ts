/**
 * Vocabulary mirror — track the user's distinctive lexicon so Mindees can
 * subtly mirror it. Humans rate communication partners who match their
 * vocabulary as warmer + more trustworthy (extensively studied: Niederhoffer
 * & Pennebaker, "Linguistic Style Matching in Social Interaction", 2002).
 *
 * Implementation: maintain a frequency map of user tokens, filter out the
 * top ~500 English stopwords, surface the top-N rare-but-recurring tokens
 * as the user's "signature vocabulary." Mindees gets a system-prompt note
 * that says "this user often uses these words — feel free to use them too,
 * sparingly."
 *
 * Per-thread.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const DIR = dataPath("vocab-mirror");
const MAX_VOCAB_ITEMS = 80;
const MIN_LEN = 4;
const MIN_OCCURRENCES = 3;

// Very small English stopword set — keeps the signature focused on
// distinctive content words rather than function words.
const STOP = new Set([
  "the", "and", "but", "for", "from", "with", "this", "that", "these",
  "those", "what", "when", "where", "which", "while", "would", "could",
  "should", "have", "been", "being", "into", "your", "yours", "they",
  "their", "them", "about", "after", "again", "back", "down", "more",
  "most", "much", "must", "only", "over", "really", "right", "same",
  "some", "such", "than", "then", "there", "thing", "things", "think",
  "though", "through", "thus", "very", "want", "well", "were", "what",
  "yeah", "okay",
]);

interface VocabFile {
  threadId: string;
  counts: Record<string, number>;
  totalTokens: number;
  updatedAt: string;
}

function fileFor(threadId: string): string {
  return path.join(DIR, `${threadId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

async function load(threadId: string): Promise<VocabFile> {
  try {
    const raw = await readFile(fileFor(threadId), "utf8");
    return JSON.parse(raw) as VocabFile;
  } catch {
    return { threadId, counts: {}, totalTokens: 0, updatedAt: new Date().toISOString() };
  }
}

async function persist(v: VocabFile): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(v.threadId), JSON.stringify(v), "utf8");
  } catch { /* ignore */ }
}

export async function recordUserText(threadId: string, text: string): Promise<void> {
  const v = await load(threadId);
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= MIN_LEN && !STOP.has(t));
  for (const t of tokens) {
    v.counts[t] = (v.counts[t] ?? 0) + 1;
  }
  v.totalTokens += tokens.length;
  // Prune anything that's still below MIN_OCCURRENCES once we've seen a lot of tokens
  if (v.totalTokens > 800) {
    for (const [k, c] of Object.entries(v.counts)) {
      if (c < MIN_OCCURRENCES) delete v.counts[k];
    }
  }
  v.updatedAt = new Date().toISOString();
  await persist(v);
}

export async function signatureVocab(threadId: string, limit = 12): Promise<string[]> {
  const v = await load(threadId);
  return Object.entries(v.counts)
    .filter(([, c]) => c >= MIN_OCCURRENCES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

export function vocabNarrative(words: string[]): string {
  if (words.length === 0) return "";
  return `This user often uses words like: ${words.slice(0, 10).join(", ")}. Feel free to use them yourself, sparingly — it should feel like shared register, not mimicry. Don't lift more than two per reply.`;
}

void MAX_VOCAB_ITEMS;
