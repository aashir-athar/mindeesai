/**
 * calculator connector — safe expression evaluator with broad real-world coverage.
 *
 * What it handles (no eval(), no Function()):
 *   - basic arithmetic: + - * / %
 *   - exponentiation: ^ or **        (right-associative)
 *   - parens, brackets, braces:  ( [ {  ↔  ) ] }       (all interchangeable)
 *   - factorial postfix:  N!         (integer factorial only, capped at 170!)
 *   - functions:   sqrt cbrt abs floor ceil round
 *                  ln log log2 log10
 *                  sin cos tan asin acos atan atan2
 *                  exp min max pow gcd lcm
 *   - constants:   pi e tau inf
 *   - Unicode normalisation BEFORE tokenising:
 *       superscripts ⁰¹²³⁴⁵⁶⁷⁸⁹ ⁺⁻ ⁽⁾    → ^(... )
 *       subscripts   ₀₁₂₃₄₅₆₇₈₉           → _(... )
 *       × ⋅ ·                              → *
 *       ÷ ⁄                                → /
 *       √                                  → sqrt
 *       ∛                                  → cbrt
 *       − ‒ – —                            → -
 *       π                                  → pi
 *       ∞                                  → inf
 *       {} []                              → ()
 *   - implicit multiplication: 2(x) and )(   become 2*(x) and )*(
 *   - 1024-char hard cap (raised from 256 — real math expressions are long)
 *
 * Returns:  { ok: true, output: { expression: original, normalised, value } }
 * Or:       { ok: false, error: <human-readable> }
 *
 * Whitelist-only tokenizer. No identifier outside the function/constant tables
 * is allowed. No filesystem, no network, no prototype access, no JS eval.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { expression: string };

const handler: ConnectorHandler<Args> = async (args) => {
  const { expression } = args ?? ({} as Args);
  if (!expression || typeof expression !== "string") {
    return { ok: false, error: "expression required" };
  }
  if (expression.length > 1024) {
    return { ok: false, error: `expression too long (${expression.length} chars; limit 1024)` };
  }
  try {
    const normalised = normaliseUnicode(expression);
    const value = evaluate(normalised);
    if (!Number.isFinite(value)) {
      return { ok: false, error: `result is ${value === Infinity ? "infinity" : value === -Infinity ? "-infinity" : "NaN"}` };
    }
    return { ok: true, output: { expression, normalised, value } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export default handler;

// ─── Unicode normalisation ───────────────────────────────────────────────────

const SUPER_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")",
};
const SUB_MAP: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

const SUPER_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+/g;
const SUB_RE = /[₀₁₂₃₄₅₆₇₈₉]+/g;

/**
 * Convert real-world math notation into a form the tokenizer accepts.
 * Conservative — we only rewrite what we recognise. Anything weird falls
 * through to the tokenizer which will throw a clear error.
 */
function normaliseUnicode(input: string): string {
  let s = input;

  // Superscript runs → `^(...)` so they bind tightly to whatever's before.
  //   4³  →  4^(3)
  //   2¹⁰ →  2^(10)
  s = s.replace(SUPER_RE, (run) => {
    const ascii = Array.from(run).map((ch) => SUPER_MAP[ch] ?? ch).join("");
    return `^(${ascii})`;
  });
  // Subscript runs → `_<digits>` (currently a no-op for math, but at least
  // doesn't break the tokenizer). We strip them to avoid garbage in the
  // expression — the tokenizer would reject `_` anyway.
  s = s.replace(SUB_RE, (run) => {
    const ascii = Array.from(run).map((ch) => SUB_MAP[ch] ?? ch).join("");
    // Push subscripts into a comment-like dropoff: not used in evaluation.
    return ascii ? `` : "";
  });

  // Operators
  s = s
    .replace(/[×⋅·]/g, "*")
    .replace(/[÷⁄]/g, "/")
    .replace(/[−‒–—]/g, "-");

  // Constants / functions written as symbols
  s = s
    .replace(/π/g, "pi")
    .replace(/τ/g, "tau")
    .replace(/∞/g, "inf")
    .replace(/√/g, " sqrt")
    .replace(/∛/g, " cbrt");

  // Square-root variants where the argument follows without parens:
  //   sqrt225  →  sqrt(225)
  //   sqrt 225 →  sqrt(225)
  s = s.replace(/\bsqrt\s*(\d+(?:\.\d+)?)/g, "sqrt($1)");
  s = s.replace(/\bcbrt\s*(\d+(?:\.\d+)?)/g, "cbrt($1)");

  // Brackets and braces → parens. The shunting-yard only knows ().
  s = s.replace(/[\[{]/g, "(").replace(/[\]}]/g, ")");

  // Whitespace collapse for cleaner tokens
  return s.replace(/\s+/g, " ").trim();
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Tok =
  | { kind: "num"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" }
  | { kind: "factorial" };

function tokenize(input: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      // Optional exponent (1e9)
      if (j < input.length && (input[j] === "e" || input[j] === "E")) {
        j++;
        if (j < input.length && (input[j] === "+" || input[j] === "-")) j++;
        while (j < input.length && /[0-9]/.test(input[j]!)) j++;
      }
      const num = parseFloat(input.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`bad number at ${i}: ${input.slice(i, j)}`);
      out.push({ kind: "num", value: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j]!)) j++;
      out.push({ kind: "ident", value: input.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    // Multi-char ops first
    if (c === "*" && input[i + 1] === "*") { out.push({ kind: "op", value: "^" }); i += 2; continue; }
    if (c === "(" || c === ")") { out.push({ kind: c === "(" ? "lparen" : "rparen" }); i++; continue; }
    if (c === ",") { out.push({ kind: "comma" }); i++; continue; }
    if (c === "!") { out.push({ kind: "factorial" }); i++; continue; }
    if ("+-*/%^".includes(c)) { out.push({ kind: "op", value: c }); i++; continue; }
    throw new Error(`unexpected character '${c}' at position ${i}`);
  }
  return insertImplicitMults(out);
}

/** Insert `*` between a value-producing token and an identifier/paren. */
function insertImplicitMults(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const prev = out[out.length - 1];
    if (
      prev &&
      (prev.kind === "num" || prev.kind === "rparen" || prev.kind === "factorial") &&
      (t.kind === "lparen" || t.kind === "ident")
    ) {
      out.push({ kind: "op", value: "*" });
    }
    out.push(t);
  }
  return out;
}

// ─── Parser + evaluator (recursive descent with precedence climbing) ────────

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  inf: Infinity,
};

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log(x),
  log2: (x) => Math.log2(x),
  log10: (x) => Math.log10(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  atan: (x) => Math.atan(x),
  atan2: (y, x) => Math.atan2(y, x),
  exp: (x) => Math.exp(x),
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  pow: (a, b) => a ** b,
  factorial: (n) => factorial(n),
  gcd: (a, b) => gcd(a, b),
  lcm: (a, b) => lcm(a, b),
};

const PRECEDENCE: Record<string, number> = {
  "+": 1, "-": 1,
  "*": 2, "/": 2, "%": 2,
  "^": 3,
};
const RIGHT_ASSOC = new Set(["^"]);

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`factorial requires non-negative integer, got ${n}`);
  if (n > 170) throw new Error(`factorial too large (${n}! overflows IEEE 754)`);
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function gcd(a: number, b: number): number {
  a = Math.abs(Math.trunc(a)); b = Math.abs(Math.trunc(b));
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.trunc(a) * Math.trunc(b)) / gcd(a, b);
}

class Parser {
  pos = 0;
  constructor(public toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.pos]; }
  consume(): Tok { return this.toks[this.pos++]!; }
  expect(kind: Tok["kind"]): Tok {
    const t = this.peek();
    if (!t || t.kind !== kind) throw new Error(`expected ${kind}, got ${t ? t.kind : "EOF"}`);
    return this.consume();
  }

  parseExpression(minPrec = 1): number {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op") break;
      const prec = PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.consume();
      const nextMin = RIGHT_ASSOC.has(t.value) ? prec : prec + 1;
      const right = this.parseExpression(nextMin);
      left = applyOp(t.value, left, right);
    }
    return this.parsePostfix(left);
  }

  parseUnary(): number {
    const t = this.peek();
    if (t && t.kind === "op" && (t.value === "+" || t.value === "-")) {
      this.consume();
      const operand = this.parseUnary();
      return t.value === "-" ? -operand : operand;
    }
    return this.parsePostfix(this.parsePrimary());
  }

  parsePostfix(value: number): number {
    let v = value;
    while (true) {
      const t = this.peek();
      if (!t) break;
      if (t.kind === "factorial") { this.consume(); v = factorial(v); continue; }
      break;
    }
    return v;
  }

  parsePrimary(): number {
    const t = this.peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.kind === "num") { this.consume(); return t.value; }
    if (t.kind === "lparen") {
      this.consume();
      const v = this.parseExpression();
      this.expect("rparen");
      return v;
    }
    if (t.kind === "ident") {
      this.consume();
      const name = t.value;
      // function call?
      if (this.peek()?.kind === "lparen") {
        this.consume();
        const args: number[] = [];
        if (this.peek()?.kind !== "rparen") {
          args.push(this.parseExpression());
          while (this.peek()?.kind === "comma") {
            this.consume();
            args.push(this.parseExpression());
          }
        }
        this.expect("rparen");
        const fn = FUNCS[name];
        if (!fn) throw new Error(`unknown function: ${name}`);
        return fn(...args);
      }
      // constant
      const c = CONSTANTS[name];
      if (c !== undefined) return c;
      throw new Error(`unknown identifier: ${name}`);
    }
    throw new Error(`unexpected token: ${t.kind}`);
  }
}

function applyOp(op: string, a: number, b: number): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "%": return a % b;
    case "^": return a ** b;
    default: throw new Error(`unknown operator ${op}`);
  }
}

function evaluate(expr: string): number {
  const toks = tokenize(expr);
  if (toks.length === 0) throw new Error("empty expression");
  const p = new Parser(toks);
  const value = p.parseExpression();
  if (p.peek() !== undefined) {
    throw new Error(`unexpected trailing token after position ${p.pos}: ${JSON.stringify(p.peek())}`);
  }
  return value;
}
