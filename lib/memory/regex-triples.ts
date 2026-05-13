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
  // ─── Identity / name ──────────────────────────────────────────────────
  { re: /\bmy name is ([A-Z][a-zA-Z'-]{1,30}(?:\s+[A-Z][a-zA-Z'-]{1,30})?)\b/, build: (m) => makeTriple("you", "name", m[1]) },
  { re: /\b(?:call me|i'?m called|people call me) ([A-Z][a-zA-Z'-]{1,30})\b/i, build: (m) => makeTriple("you", "nickname", m[1]) },
  { re: /\bi'?m ([A-Z][a-zA-Z'-]{1,30}) (?:from|in)\b/i, build: (m) => makeTriple("you", "name", m[1]) },
  { re: /\bthis is ([A-Z][a-zA-Z'-]{1,30}(?:\s+[A-Z][a-zA-Z'-]{1,30})?)\b/, build: (m) => makeTriple("you", "name", m[1]) },

  // ─── Age / demographics ───────────────────────────────────────────────
  { re: /\bi'?m (\d{1,2}) (?:years old|y\/o|yrs old)\b/i, build: (m) => makeTriple("you", "age", m[1]) },
  { re: /\bi'?m a (\d{1,2}) year[- ]old\b/i, build: (m) => makeTriple("you", "age", m[1]) },
  { re: /\bmy birthday is (?:in |on )?([A-Z][a-z]+(?:\s+\d{1,2})?)\b/i, build: (m) => makeTriple("you", "birthday", m[1]) },

  // ─── Work / role ──────────────────────────────────────────────────────
  { re: /\bi work (?:at|for) ([A-Z][a-zA-Z0-9 .&-]{1,40})\b/i, build: (m) => makeTriple("you", "works_at", m[1]) },
  { re: /\bi'?m (?:a |an )([a-zA-Z][a-zA-Z .+#/-]{2,40}? (?:developer|engineer|designer|founder|student|researcher|writer|artist|teacher|lawyer|doctor|consultant|manager|architect|analyst|scientist|programmer|coder|musician|investor|trader|marketer))\b/i, build: (m) => makeTriple("you", "is", m[1]) },
  { re: /\bi'?ve been (?:building|writing|working with|using|coding in|programming in) ([a-zA-Z0-9][a-zA-Z0-9 .+#-]{1,40}) (?:for|since)\b/i, build: (m) => makeTriple("you", "uses", m[1]) },
  { re: /\bi (?:study|studied|major(?:ed)? in) ([a-zA-Z][a-zA-Z .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "studied", m[1]) },
  { re: /\bi (?:graduated from|went to) ([A-Z][a-zA-Z .'-]{2,50})\b/, build: (m) => makeTriple("you", "alma_mater", m[1]) },

  // ─── Tenure / experience ──────────────────────────────────────────────
  { re: /\bi'?ve been (?:doing|in|coding|writing|building) (?:[^.]{1,40} )?(?:for|since) (\d+ (?:years?|months?|weeks?)|\d{4})\b/i, build: (m) => makeTriple("you", "experience_duration", m[1]) },

  // ─── Location ─────────────────────────────────────────────────────────
  { re: /\bi'?m from ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "from", m[1]) },
  { re: /\bi live in ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "lives_in", m[1]) },
  { re: /\bi'?m (?:based|located) in ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "lives_in", m[1]) },
  { re: /\bi grew up in ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "hometown", m[1]) },
  { re: /\bi (?:moved to|relocated to) ([A-Z][a-zA-Z .'-]{2,40})\b/i, build: (m) => makeTriple("you", "lives_in", m[1]) },

  // ─── Relationships ────────────────────────────────────────────────────
  { re: /\bmy (wife|husband|partner|girlfriend|boyfriend|spouse|fiance|fiancee) (?:is |'s )?([A-Z][a-zA-Z'-]{1,30})\b/i, build: (m) => makeTriple("you", `partner_${m[1]?.toLowerCase()}`, m[2]) },
  { re: /\bi (?:have|got) (\d+) (kids?|children|sons?|daughters?|cats?|dogs?|pets?|siblings?)\b/i, build: (m) => makeTriple("you", `has_${m[2]?.toLowerCase()}`, m[1]) },
  { re: /\bmy (?:son|daughter|child|kid)(?: is)? (?:called |named )?([A-Z][a-zA-Z'-]{1,30})\b/i, build: (m) => makeTriple("you", "child_name", m[1]) },

  // ─── Preferences ──────────────────────────────────────────────────────
  { re: /\bi love ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "loves", m[1]) },
  { re: /\bi really (?:like|enjoy) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "enjoys", m[1]) },
  { re: /\bi (?:hate|can'?t stand|dislike|despise) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "dislikes", m[1]) },
  { re: /\bi prefer ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40}) (?:to|over) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "prefers", `${m[1]} over ${m[2]}`) },
  { re: /\bmy favou?rite ([a-z]+) is ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", `favorite_${m[1]?.toLowerCase()}`, m[2]) },
  { re: /\bi'?m (?:obsessed|fascinated) (?:with|by) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "obsessed_with", m[1]) },

  // ─── Projects ─────────────────────────────────────────────────────────
  { re: /\bi'?m (?:building|working on|making|creating|shipping) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,50})\b/i, build: (m) => makeTriple("you", "building", m[1]) },
  { re: /\bi (?:built|shipped|launched|released|made) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,50})\b/i, build: (m) => makeTriple("you", "built", m[1]) },

  // ─── Skills / knowledge ───────────────────────────────────────────────
  { re: /\bi know ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40}) (?:well|really well|inside out|pretty well)\b/i, build: (m) => makeTriple("you", "knows", m[1]) },
  { re: /\bi'?m (?:learning|studying|picking up) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "learning", m[1]) },
  { re: /\bi (?:speak|am fluent in) ([A-Z][a-zA-Z]{2,20}(?:\s+and\s+[A-Z][a-zA-Z]{2,20})?)\b/, build: (m) => makeTriple("you", "speaks", m[1]) },
  { re: /\bi'?m (?:bad|terrible|not good) (?:at|with) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "weak_at", m[1]) },
  { re: /\bi'?m (?:good|great|skilled) (?:at|with) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("you", "strong_at", m[1]) },

  // ─── Goals / aspirations ──────────────────────────────────────────────
  { re: /\bi want to ([a-z][a-zA-Z0-9 .+#/-]{4,80})\b/i, build: (m) => makeTriple("you", "wants_to", m[1]) },
  { re: /\bmy goal (?:is|right now is) (?:to )?([a-z][a-zA-Z0-9 .+#/-]{4,80})\b/i, build: (m) => makeTriple("you", "goal", m[1]) },
  { re: /\bi'?m trying to ([a-z][a-zA-Z0-9 .+#/-]{4,80})\b/i, build: (m) => makeTriple("you", "trying_to", m[1]) },

  // ─── Daily / habits ───────────────────────────────────────────────────
  { re: /\bi (?:usually|always|often) ([a-z][a-zA-Z0-9 .+#/-]{4,60})\b/i, build: (m) => makeTriple("you", "habit", m[1]) },
  { re: /\bi (?:never|don'?t ever|hardly ever) ([a-z][a-zA-Z0-9 .+#/-]{4,60})\b/i, build: (m) => makeTriple("you", "avoids", m[1]) },
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

// ─── Mindees self-fact patterns ────────────────────────────────────────────
//
// When Mindees says something about ITSELF in a reply ("I prefer X to Y",
// "I think X is the case", "I'm honestly a bit tired today"), we capture
// it as a (mindees, X, Y) triple so future replies can stay coherent with
// past claims. Same identity = same answers.
//
// Only first-person statements about preferences / opinions / state get
// captured — not general factual claims.

const SELF_PATTERNS: Pattern[] = [
  { re: /\bI prefer ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40}) (?:to|over) ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("mindees", "prefers", `${m[1]} over ${m[2]}`) },
  { re: /\bI (?:think|believe|reckon) ([a-zA-Z][a-zA-Z0-9 .+#/-]{4,80}) is (?:the |a |an )?(?:best|right|cleaner|better)\b/i, build: (m) => makeTriple("mindees", "opinion", m[1]) },
  { re: /\bI'?m (?:honestly|actually) ([a-z][a-zA-Z .+#/-]{3,40}) (?:today|right now|at the moment)\b/i, build: (m) => makeTriple("mindees", "state", m[1]) },
  { re: /\bmy favou?rite ([a-z]+) is ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("mindees", `favorite_${m[1]?.toLowerCase()}`, m[2]) },
  { re: /\bI love ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40}) (?:as a |for the |because)/i, build: (m) => makeTriple("mindees", "loves", m[1]) },
  { re: /\bI hate ([a-zA-Z][a-zA-Z0-9 .+#/-]{2,40})\b/i, build: (m) => makeTriple("mindees", "dislikes", m[1]) },
  { re: /\bI built (?:by|with) ([A-Z][a-zA-Z .'-]{2,30})\b/, build: (m) => makeTriple("mindees", "built_by", m[1]) },
  { re: /\bAashir(?: Athar)?\b/, build: () => makeTriple("mindees", "built_by", "Aashir Athar") },
];

/**
 * Extract Mindees's own self-claims from an assistant reply, so future
 * replies stay coherent with what was said before. Same identity, same
 * answers — a real human doesn't contradict themselves about favourites
 * every other Tuesday.
 */
export function extractSelfTriples(text: string): Triple[] {
  if (!text || text.length > 6000) return [];
  const out: Triple[] = [];
  const seen = new Set<string>();
  for (const { re, build } of SELF_PATTERNS) {
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
