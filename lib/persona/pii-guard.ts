/**
 * PII guard — redacts personal information before it hits public storage.
 *
 * **Why this is critical:** every chat turn is appended to
 * `data/distill-corpus.jsonl`, which is:
 *   1. flushed to Cloudflare R2 (private, but persistent)
 *   2. consumed by the weekly GitHub Actions retrain workflow
 *   3. pushed to HuggingFace Hub as part of `aashir-athar/mindeesai-base`
 *      revision `small-weekly` — which is a **PUBLIC model repo**
 *
 * Without this guard, anything a user types — phone numbers, emails,
 * credit card digits, addresses, social security numbers — could end up
 * baked into a public model checkpoint and impossible to remove.
 *
 * How the guard works:
 *   1. ML pass — `Xenova/piiranha-v1-detect-personal-information` token
 *      classifier identifies spans (EMAIL, PHONE, CREDITCARD, ADDRESS,
 *      SOCIALNUM, etc.) at high confidence. Lazy-loaded, ~75 MB Q8.
 *   2. Regex backstop — covers the obvious patterns the ML model might
 *      miss (international phone formats, SSN, basic credit cards).
 *      Cheap and runs synchronously even if the ML pipeline isn't
 *      loaded yet.
 *
 * Both passes redact to a typed placeholder like `[REDACTED:email]` so
 * the model still learns "the user provided an email here" without
 * learning the email itself.
 */

import { piiPipeline } from "@/lib/ml/transformers-pool";
import { createLogger } from "@/lib/logger";

const log = createLogger("pii-guard");

export type PiiSpan = {
  type: string;     // e.g. "email", "phone", "creditcard", "ssn", "address"
  start: number;
  end: number;
  score: number;    // 0-1 confidence
};

export interface PiiResult {
  /** Original text with each detected PII span replaced by `[REDACTED:<type>]`. */
  redacted: string;
  spans: PiiSpan[];
  /** true if at least one span was redacted. */
  detected: boolean;
}

/** Confidence threshold for accepting a PII span from the ML classifier. */
const PII_THRESHOLD = 0.80;

/**
 * Redact PII from `text`. ML + regex run together; results are merged
 * by span, ML takes precedence on overlap.
 *
 * Always returns within a few hundred ms — the ML pipeline runs in a
 * 2-second timeout race; on timeout or load failure, falls back to
 * regex-only. Never throws.
 */
export async function redactPII(text: string): Promise<PiiResult> {
  if (!text || text.length < 4) {
    return { redacted: text, spans: [], detected: false };
  }

  const regexSpans = regexPiiSpans(text);
  const mlSpans = await mlPiiSpans(text).catch((e) => {
    log.warn("ML PII pass failed; using regex only", e);
    return [] as PiiSpan[];
  });

  const merged = mergeSpans([...mlSpans, ...regexSpans]);
  if (merged.length === 0) {
    return { redacted: text, spans: [], detected: false };
  }
  return {
    redacted: applyRedactions(text, merged),
    spans: merged,
    detected: true,
  };
}

// ─── ML pass ────────────────────────────────────────────────────────────

type TokenClassResult = Array<{
  entity?: string;
  entity_group?: string;
  word?: string;
  start?: number;
  end?: number;
  score?: number;
}>;

async function mlPiiSpans(text: string): Promise<PiiSpan[]> {
  const pl = await Promise.race([
    piiPipeline(),
    new Promise<null>((res) => setTimeout(() => res(null), 2000)),
  ]);
  if (!pl) return [];

  try {
    // Run with aggregation strategy so multi-token entities collapse.
    const raw = (await pl(text, { aggregation_strategy: "simple" } as unknown as object)) as unknown as TokenClassResult;
    if (!Array.isArray(raw)) return [];
    const spans: PiiSpan[] = [];
    for (const r of raw) {
      const score = r.score ?? 0;
      if (score < PII_THRESHOLD) continue;
      const tag = (r.entity_group ?? r.entity ?? "").toUpperCase();
      if (!tag || tag === "O") continue;
      // Spec-shape: piiranha returns entity tags like "EMAIL", "PHONE_NUMBER", etc.
      // Normalise into lowercase short labels.
      const type = normaliseTag(tag);
      if (!type) continue;
      const start = r.start ?? 0;
      const end = r.end ?? start;
      if (end > start && end <= text.length) {
        spans.push({ type, start, end, score });
      }
    }
    return spans;
  } catch (e) {
    log.warn("ML PII inference failed", e);
    return [];
  }
}

function normaliseTag(tag: string): string | null {
  const t = tag.replace(/^B-|^I-/, "");
  if (t.includes("EMAIL")) return "email";
  if (t.includes("PHONE")) return "phone";
  if (t.includes("CREDIT") || t.includes("CARD")) return "creditcard";
  if (t.includes("SOCIAL") || t === "SSN" || t.includes("SSNUM")) return "ssn";
  if (t.includes("ADDRESS") || t === "STREET") return "address";
  if (t === "IBAN" || t.includes("ACCOUNT")) return "bankacct";
  if (t === "IP" || t.includes("IPADDR")) return "ip";
  if (t.includes("PASSPORT")) return "passport";
  if (t.includes("LICENSE") || t.includes("LICENCE")) return "license";
  if (t.includes("URL")) return "url";
  if (t === "DATE_BIRTH" || t.includes("BIRTH")) return "dob";
  if (t.includes("NAME")) return null; // names are NOT redacted — too aggressive
  return null;
}

// ─── Regex backstop ─────────────────────────────────────────────────────

const REGEX_PATTERNS: Array<{ type: string; re: RegExp }> = [
  {
    type: "email",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    // International phone: +CC NNN-NNN-NNNN, with optional parens/spaces.
    // Conservative — requires 7+ digits total.
    type: "phone",
    re: /(?<![\d])(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?![\d])/g,
  },
  {
    // US SSN format: NNN-NN-NNNN
    type: "ssn",
    re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g,
  },
  {
    // Credit card — 13 to 19 digits with optional separators. Conservative
    // (false positives are OK; we'd rather redact a tracking number than
    // leak a CC).
    type: "creditcard",
    re: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
  },
  {
    // IPv4
    type: "ip",
    re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
  },
];

function regexPiiSpans(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const { type, re } of REGEX_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Some patterns (phone, credit card) need a sanity check — they
      // can match too liberally on long numbers.
      if (type === "creditcard" && m[0].replace(/\D/g, "").length < 13) continue;
      if (type === "phone" && m[0].replace(/\D/g, "").length < 7) continue;
      out.push({ type, start, end, score: 0.9 });
    }
  }
  return out;
}

// ─── Span merge + redaction ─────────────────────────────────────────────

function mergeSpans(spans: PiiSpan[]): PiiSpan[] {
  if (spans.length === 0) return [];
  // Sort by start ascending, then by score descending so ML wins on overlap.
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.score - a.score);
  const out: PiiSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      // Overlaps — extend the existing span if this one ends later, but
      // keep the original type (higher-scored, processed first).
      if (s.end > last.end) last.end = s.end;
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

function applyRedactions(text: string, spans: PiiSpan[]): string {
  if (spans.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(`[REDACTED:${s.type}]`);
    cursor = s.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.join("");
}

// ─── Convenience for the distill corpus path ────────────────────────────

/**
 * Redact PII from BOTH the user message AND the assistant reply before
 * persisting. Both ends matter — the assistant sometimes echoes user
 * data back ("So your email is X..."), so redacting only the user side
 * would still leak through the assistant turn.
 */
export async function scrubDistillRow(row: {
  user: string;
  assistant: string;
}): Promise<{ user: string; assistant: string; detected: boolean }> {
  const [u, a] = await Promise.all([redactPII(row.user), redactPII(row.assistant)]);
  return {
    user: u.redacted,
    assistant: a.redacted,
    detected: u.detected || a.detected,
  };
}
