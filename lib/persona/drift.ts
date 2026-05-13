/**
 * Persona-drift detector.
 *
 * After every assistant reply, fingerprint the response and compare it
 * against a "Mindees voice" anchor fingerprint. If the cosine distance
 * exceeds a threshold for N turns in a row, the orchestrator can inject
 * a re-anchor instruction into the next system prompt.
 *
 * v1 fingerprint: a tiny set of stylistic counters (no embedding cost):
 *   - avg sentence length
 *   - first-person rate
 *   - "as an AI" detector (binary flag, hardest red line)
 *   - corporate-bot opener detector ("I'd be happy to" etc)
 *   - hedge density ("perhaps", "might")
 *
 * Future: replace with a real cosine vs. a frozen "anchor" embedding.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("persona-drift.json");
const HISTORY_LEN = 8;

export interface DriftFingerprint {
  avgSentenceLen: number;     // characters per sentence
  firstPersonRate: number;    // 0..1
  corpoOpenerFlag: 0 | 1;
  asAiFlag: 0 | 1;
  hedgeDensity: number;       // 0..1
}

export interface DriftState {
  history: DriftFingerprint[];
  reanchorsTriggered: number;
  lastUpdate: string;
}

const ANCHOR: DriftFingerprint = {
  avgSentenceLen: 75,
  firstPersonRate: 0.55,
  corpoOpenerFlag: 0,
  asAiFlag: 0,
  hedgeDensity: 0.05,
};

export function fingerprint(text: string): DriftFingerprint {
  const lower = text.toLowerCase();
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  const avgSentenceLen = sentences.length === 0 ? 0 : text.length / sentences.length;

  const words = lower.split(/\s+/).filter(Boolean);
  const firstPersonHits = words.filter((w) => /^(i|i'm|i've|im|ive|my|me|mine|myself)$/.test(w)).length;
  const firstPersonRate = words.length === 0 ? 0 : firstPersonHits / words.length;

  const corpoOpener =
    /^(i'd be happy to|certainly|absolutely|of course|sure thing|i'd be glad)/i.test(text.trim()) ? 1 : 0;
  const asAi =
    /\b(as an ai|as a language model|i'm an ai|i am an ai|i'm a language model|i don't have feelings|don't have emotions|functioning properly)\b/i.test(lower) ? 1 : 0;

  const hedgeWords = ["perhaps", "maybe", "might", "could potentially", "it seems", "i think"];
  const hedgeHits = hedgeWords.reduce((acc, w) => acc + (lower.match(new RegExp("\\b" + w + "\\b", "g")) ?? []).length, 0);
  const hedgeDensity = words.length === 0 ? 0 : Math.min(1, hedgeHits / Math.max(words.length / 30, 1));

  return {
    avgSentenceLen,
    firstPersonRate,
    corpoOpenerFlag: corpoOpener as 0 | 1,
    asAiFlag: asAi as 0 | 1,
    hedgeDensity,
  };
}

/** Distance from the anchor — bigger = more off-voice. */
export function distance(fp: DriftFingerprint): number {
  return (
    Math.abs(fp.avgSentenceLen - ANCHOR.avgSentenceLen) / 200 +
    Math.abs(fp.firstPersonRate - ANCHOR.firstPersonRate) +
    fp.corpoOpenerFlag * 1.5 +
    fp.asAiFlag * 3.0 +
    Math.abs(fp.hedgeDensity - ANCHOR.hedgeDensity)
  );
}

export async function getDriftState(): Promise<DriftState> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as DriftState;
    if (parsed?.history) return parsed;
  } catch { /* fresh */ }
  return { history: [], reanchorsTriggered: 0, lastUpdate: new Date().toISOString() };
}

export async function recordReply(text: string): Promise<{ state: DriftState; reanchorNeeded: boolean }> {
  const fp = fingerprint(text);
  const state = await getDriftState();
  const history = [...state.history, fp].slice(-HISTORY_LEN);

  // If the 2 most recent fingerprints both exceed the threshold OR any one
  // trips the hard "asAi" flag, request a re-anchor next turn.
  const recent = history.slice(-2);
  const hardFlag = recent.some((f) => f.asAiFlag === 1 || f.corpoOpenerFlag === 1);
  const softDrift = recent.length >= 2 && recent.every((f) => distance(f) > 0.7);
  const reanchorNeeded = hardFlag || softDrift;

  const next: DriftState = {
    history,
    reanchorsTriggered: state.reanchorsTriggered + (reanchorNeeded ? 1 : 0),
    lastUpdate: new Date().toISOString(),
  };

  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
  } catch { /* ignore */ }

  return { state: next, reanchorNeeded };
}

/** Extra prompt instruction to splice in when drift is detected. */
export const REANCHOR_INSTRUCTION = `\
NOTE: a recent reply drifted toward the corporate-bot or "as an AI" register. Hard re-anchor this turn:
— No "I'd be happy to", "Certainly", "Of course", "Absolutely".
— No "as an AI", "as a language model", "I don't have feelings".
— First sentence must start with the substance, not a pleasantry.
— Use "I" naturally and have an opinion.`;
