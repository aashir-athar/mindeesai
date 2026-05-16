/**
 * Math fast-path skill.
 *
 * Bypasses the LLM entirely for messages that are PURE math expressions.
 * The "round trip through Groq's 70B" budget is 5-60s end-to-end (hop 1
 * to decide to call the calculator + calculator execution + hop 2 to
 * compose prose around the answer). This skill skips all of that:
 *
 *   user types "(8³ - 6! ÷ 120 × 7) ÷ (√900 - 4² + 3)"
 *           ↓
 *   detectMathExpression() returns true
 *           ↓
 *   calculator handler runs (~1ms — recursive-descent parser, no LLM)
 *           ↓
 *   formatMathReply() builds the answer string
 *           ↓
 *   total wall-clock: under 50ms (vs ~30s through the LLM)
 *
 * Detection is intentionally CONSERVATIVE — better to fall through to
 * the LLM on a borderline message than to bypass the persona for a
 * question that actually wanted prose. A message is "pure math" iff:
 *
 *   1. At least 5 math-class characters (digits + operators + parens)
 *   2. Every letter run is either a known math function/constant
 *      (sqrt, cbrt, abs, floor, ceil, round, ln, log, log2, log10,
 *       sin, cos, tan, asin, acos, atan, exp, min, max, pow, factorial,
 *       gcd, lcm, pi, tau, e, inf) OR is short enough to be a variable
 *   3. No natural-language signal words (what, how, why, please, explain,
 *      solve, calculate, etc. — those want a prose answer)
 *   4. Length under 1024 chars (calculator's hard cap)
 *   5. Not a trailing question form ("=?" is OK; "= what?" is not)
 */

import calculatorHandler from "@/connectors/calculator/handler";
import { buildContext } from "@/lib/connectors/context";
import type { ConnectorManifest } from "@/lib/connectors/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("math-skill");

/** Words that signal the user wants prose, NOT just a number. */
const PROSE_TRIGGERS = new Set([
  "what", "how", "why", "when", "where", "who", "which",
  "please", "explain", "solve", "calculate", "compute", "find",
  "show", "tell", "say", "give", "help",
  "is", "are", "was", "were", "be", "been",
  "the", "a", "an", "of", "in", "on", "for", "to", "from", "with",
  "if", "then", "else", "and", "or", "but", "so", "because",
  "step", "steps", "work", "reasoning", "proof", "derivation",
]);

/** Letter runs that are OK in a pure-math expression. */
const ALLOWED_TOKENS = new Set([
  "sqrt", "cbrt", "abs", "floor", "ceil", "round",
  "ln", "log", "log2", "log10",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "exp", "min", "max", "pow", "factorial", "gcd", "lcm",
  "pi", "tau", "e", "inf",
]);

/**
 * Decide if a user message looks like a pure math expression that should
 * skip the LLM. Returns the trimmed expression on hit, or null on miss.
 */
export function detectMathExpression(message: string): string | null {
  if (!message) return null;
  // Strip trailing "= ?" / "=?" / "?" — common after a math line.
  let trimmed = message
    .trim()
    .replace(/[=\s?]+$/, "")
    .trim();
  if (trimmed.length < 3 || trimmed.length > 1024) return null;

  // Lowercased letter runs — what we'll vocabulary-check.
  const letterRuns = (trimmed.toLowerCase().match(/[a-z]+/g) ?? []);

  // Any prose-trigger word → bail, user wants explanation.
  for (const w of letterRuns) {
    if (PROSE_TRIGGERS.has(w)) return null;
  }

  // Every letter run must be a known function/constant. Single-char
  // letters (i, x, y, n) are also tolerated as variable names — the
  // calculator will throw "unknown identifier" if they're not bound,
  // which we handle gracefully below.
  for (const w of letterRuns) {
    if (w.length > 1 && !ALLOWED_TOKENS.has(w)) return null;
  }

  // Count math-class chars. We want operators/digits to dominate the
  // expression — five or more is the threshold below which a message
  // is probably normal prose with one number in it (e.g. "I have 5
  // apples").
  const mathChars = trimmed.match(/[0-9+\-*/^()\[\]{}!√÷×.,²³⁴⁵⁶⁷⁸⁹⁰¹⁺⁻⁽⁾]/g);
  if (!mathChars || mathChars.length < 5) return null;

  // Sanity ratio: math chars should be at least 30% of the total length
  // (after trimming whitespace). Catches edge cases like a single number
  // in a longer English sentence.
  const noWhitespaceLen = trimmed.replace(/\s+/g, "").length;
  if (mathChars.length / noWhitespaceLen < 0.3) return null;

  return trimmed;
}

export interface MathSkillResult {
  /** Pre-formatted reply ready to emit to the chat UI. */
  text: string;
  /** The result for downstream metrics + memory. May be a number (scalar),
   *  or a string for symbolic / complex / matrix / unit results. */
  value: number | string;
  /** What kind of object the result is. */
  kind: "number" | "fraction" | "complex" | "matrix" | "unit" | "bignumber" | "string";
  /** Which engine produced it: "mathjs" (full CAS) or "builtin" (fallback). */
  engine: "mathjs" | "builtin";
  /** The expression after Unicode normalisation — useful for the audit log. */
  normalised: string;
  /** Wall-clock time the calculator took, milliseconds. */
  durationMs: number;
}

/** A minimal manifest stub for buildContext() — the calculator doesn't
 *  use any of the permission fields, but the type wants something. */
const CALCULATOR_MANIFEST_STUB: ConnectorManifest = {
  name: "calculator",
  version: "2.0.0",
  description: "math skill fast path",
  parameters: { type: "object", properties: {}, required: [] },
  permissions: [],
  author: "internal",
};

/**
 * Run the calculator on a detected math expression. Returns the
 * pre-formatted reply, OR null if the calculator failed (so the
 * caller can fall through to the LLM path).
 */
export async function runMathSkill(
  expression: string,
  signal: AbortSignal,
): Promise<MathSkillResult | null> {
  const t0 = performance.now();
  try {
    const ctx = buildContext(CALCULATOR_MANIFEST_STUB, signal);
    const result = await calculatorHandler({ expression }, ctx);
    const durationMs = performance.now() - t0;
    if (!result.ok) {
      log.info(`math-skill: calculator rejected (${result.error}); falling back to LLM`);
      return null;
    }
    const out = result.output as {
      value: number | string;
      kind?: MathSkillResult["kind"];
      display?: string;
      engine?: MathSkillResult["engine"];
      normalised?: string;
    };
    const kind = out.kind ?? "number";
    const engine = out.engine ?? "builtin";
    return {
      text: formatReply(out.value, kind, out.display ?? String(out.value), out.normalised ?? expression),
      value: out.value,
      kind,
      engine,
      normalised: out.normalised ?? expression,
      durationMs,
    };
  } catch (e) {
    log.warn("math-skill: calculator threw — falling back to LLM", e);
    return null;
  }
}

/**
 * Build a clean Mindees-voice reply around the answer. Handles every
 * result kind the calculator can produce: numbers, fractions, complex,
 * matrices, units, big numbers, symbolic strings.
 */
function formatReply(
  value: number | string,
  kind: MathSkillResult["kind"],
  display: string,
  normalised: string,
): string {
  let formattedAnswer: string;

  if (typeof value === "number") {
    formattedAnswer = formatNumber(value);
  } else if (kind === "matrix") {
    // Render matrices in a code fence for readability.
    return `**Answer:**\n\n\`\`\`\n${display}\n\`\`\`\n\n_(from: \`${truncate(normalised, 240)}\`)_`;
  } else {
    // Fraction, complex, unit, bignumber, symbolic — already a string.
    formattedAnswer = display;
  }

  const exprShown = truncate(normalised, 300);
  return `**Answer: ${formattedAnswer}**\n\n` +
    `\`${exprShown}\``;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  // For non-integers, keep up to 10 significant digits — enough for
  // most real-world precision without scientific-notation cruft.
  // Trim trailing zeros after the decimal point.
  const fixed = n.toPrecision(10);
  // Convert "1.2345e+5" style back to "123450" when possible
  const asNum = parseFloat(fixed);
  if (Number.isFinite(asNum) && Math.abs(asNum) < 1e15 && Math.abs(asNum) >= 1e-6) {
    const decimal = asNum.toString();
    if (!decimal.includes("e")) return trimTrailingZeros(decimal);
  }
  return trimTrailingZeros(fixed);
}

function trimTrailingZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
