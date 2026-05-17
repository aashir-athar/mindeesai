/**
 * PII detection + redaction. Mirrors lib/persona/pii-guard.ts from the
 * main app, but runs the ML pass natively here. Regex backstop remains
 * inside the main app's pii-guard wrapper.
 */

import { piiPipeline } from "./transformers-pool.js";
import type { PiiSpan, PiiResponse } from "./types.js";

const PII_THRESHOLD = 0.80;

type TokenClassResult = Array<{
  entity?: string;
  entity_group?: string;
  word?: string;
  start?: number;
  end?: number;
  score?: number;
}>;

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
  if (t.includes("NAME")) return null;
  return null;
}

function applyRedactions(text: string, spans: PiiSpan[]): string {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(`[REDACTED:${s.type}]`);
    cursor = s.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.join("");
}

export async function redactPii(text: string): Promise<PiiResponse> {
  if (!text || text.length < 4) {
    return { redacted: text, spans: [], detected: false };
  }
  const pl = await Promise.race([
    piiPipeline(),
    new Promise<null>((res) => setTimeout(() => res(null), 5000)),
  ]);
  if (!pl) {
    return { redacted: text, spans: [], detected: false };
  }
  try {
    const raw = (await pl(text, { aggregation_strategy: "simple" } as unknown as object)) as unknown as TokenClassResult;
    if (!Array.isArray(raw)) return { redacted: text, spans: [], detected: false };
    const spans: PiiSpan[] = [];
    for (const r of raw) {
      const score = r.score ?? 0;
      if (score < PII_THRESHOLD) continue;
      const tag = (r.entity_group ?? r.entity ?? "").toUpperCase();
      if (!tag || tag === "O") continue;
      const type = normaliseTag(tag);
      if (!type) continue;
      const start = r.start ?? 0;
      const end = r.end ?? start;
      if (end > start && end <= text.length) {
        spans.push({ type, start, end, score });
      }
    }
    if (spans.length === 0) return { redacted: text, spans: [], detected: false };
    return { redacted: applyRedactions(text, spans), spans, detected: true };
  } catch (e) {
    console.warn("[pii] inference failed:", e);
    return { redacted: text, spans: [], detected: false };
  }
}
