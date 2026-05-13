/**
 * Regex-based knowledge-graph triple extraction.
 *
 * The LLM-based extractor in lib/persona/extract-triples.ts is good but
 * fires only after a turn and depends on the LLM remembering to capture
 * facts. The graph stayed at 2 triples after 6 chat turns in production
 * because of this.
 *
 * This module is the deterministic fallback: on EVERY user message we
 * scan for canonical "self-disclosure" patterns and emit triples
 * synchronously. Zero LLM cost, zero latency.
 *
 * Patterns covered (each maps to a fixed predicate):
 *   "I work at Google"               → you / works_at / Google
 *   "I'm a Rust developer"           → you / is / Rust developer
 *   "I'm from Karachi"               → you / from / Karachi
 *   "I live in Berlin"               → you / lives_in / Berlin
 *   "my name is Aashir"              → you / name / Aashir
 *   "call me Mike"                   → you / nickname / Mike
 *   "I love {X}"                     → you / loves / X
 *   "I hate {X}"                     → you / dislikes / X
 *   "I'm building {X}"               → you / building / X
 *   "I'm working on {X}"             → you / working_on / X
 *   "my favorite {kind} is {value}"  → you / favorite_{kind} / value
 *   "I prefer {X} (to|over) {Y}"     → you / prefers / X over Y
 *   "I have {N} {kind}"              → you / has_{kind} / N
 *
 * Output goes through the existing addTriples() so it lands in the same
 * graph.json the /memory-graph page reads.
 */

import type { Triple } from "@/lib/memory/graph";

interface Pattern {
  re: RegExp;
  build: (m: RegExpExecArray) => Triple | null;
}

const now = () => new Date().toISOString();
const trim = (s: string) =>
  s.trim()
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^['"]/, "")
    .replace(/['"]$/, "")
    .trim()
    .slice(0, 60);

const PATTERNS: Pattern[] = [
  // Identity / name
  { re: /\bmy name is ([A-Z][a-zA-Z'-]{1,30}(?:\s+[A-Z][a-zA-Z'-]{1,30})?)\b/, build: (m) => makeTriple("you", "name", m[1]) },
  { re: /\b(?:call me|i'?m called|people call me) ([A-Z][a-zA-Z'-]{1,30})\b/i, build: (m) => makeTriple("you", "nickname", m[1]) },
  { re: /\bi'?m ([A-Z][a-zA-Z'-]{1,30}) (?:from|in)\b/i, build: (m) => makeTriple("you", "name", m[1]) },

  // Work / role
  { re: /\bi work (?:at|for) ([A-Z][a-zA-Z0-9 .&-]{1,40})\b/i, build: (m) => makeTriple("you", "works_at", m[1]) },
  { re: /\bi'?m (?:a |an )([a-zA-Z][a-zA-Z .+#/-]{2,40}? (?:developer|engineer|designer|founder|student|researcher|writer|artist|teacher|lawyer|doctor|consultant|manager|architect|analyst))\b/i, build: (m) => makeTriple("you", "is", m[1]) },
  { re: /\bi'?ve been (?:building|writing|working with|using|coding in) ([a-zA-Z0-9][a-zA-Z0-9 .+#-]{1,40}) (?:for|since)\b/i, build: (m) => makeTriple("you", "uses", m[1]) },

  // Location
  { re: /\bi'?m from ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "from", m[1]) },
  { re: /\bi live in ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "lives_in", m[1]) },
  { re: /\bi'?m (?:based|located) in ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "lives_in", m[1]) },

  // Preferences
  { re: /\bi love ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "loves", m[1]) },
  { re: /\bi (?:hate|can'?t stand|dislike) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "dislikes", m[1]) },
  { re: /\bi prefer ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40}) (?:to|over) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "prefers", `${m[1]} over ${m[2]}`) },
  { re: /\bmy favou?rite ([a-z]+) is ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", `favorite_${m[1]?.toLowerCase()}`, m[2]) },

  // Projects
  { re: /\bi'?m (?:building|working on|making|creating|shipping) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,50})\b/i, build: (m) => makeTriple("you", "building", m[1]) },
  { re: /\bi (?:built|shipped|launched|released) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,50})\b/i, build: (m) => makeTriple("you", "built", m[1]) },

  // Skills / knowledge
  { re: /\bi know ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40}) (?:well|really well|inside out)\b/i, build: (m) => makeTriple("you", "knows", m[1]) },
  { re: /\bi'?m (?:learning|studying) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "learning", m[1]) },
];

function makeTriple(subject: string, predicate: string, rawObject: string | undefined): Triple | null {
  if (!rawObject) return null;
  const obj = trim(rawObject);
  if (!obj || obj.length < 2) return null;
  return { subject, predicate, object: obj, source: "regex", createdAt: now() };
}

/**
 * Extract canonical self-disclosure triples from a user message.
 * Pure function — no I/O. Caller persists via addTriples().
 */
export function extractRegexTriples(text: string): Triple[] {
  if (!text || text.length > 4000) return [];
  const out: Triple[] = [];
  const seen = new Set<string>();
  for (const { re, build } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const t = build(m);
    if (!t) continue;
    const key = `${t.subject}|${t.predicate}|${t.object.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
