/**
 * calculator connector — safe expression evaluator using a tiny shunting-yard parser.
 * No eval(), no Function(). Whitelist-only tokenizer.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { expression: string };

const handler: ConnectorHandler<Args> = async (args) => {
  const { expression } = args ?? ({} as Args);
  if (!expression || expression.length > 256) {
    return { ok: false, error: "expression required (≤ 256 chars)" };
  }
  try {
    const value = evaluate(expression);
    return { ok: true, output: { expression, value } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export default handler;

// ─── implementation ──────────────────────────────────────────────────────────

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "**": 3 };
const RIGHT_ASSOC = new Set(["**"]);

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      tokens.push(input.slice(i, j));
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < input.length && /[a-z]/i.test(input[j]!)) j++;
      tokens.push(input.slice(i, j).toLowerCase());
      i = j;
      continue;
    }
    if (c === "*" && input[i + 1] === "*") { tokens.push("**"); i += 2; continue; }
    if ("+-*/%()".includes(c)) { tokens.push(c); i++; continue; }
    throw new Error(`unexpected character ${c}`);
  }
  return tokens;
}

function toRpn(tokens: string[]): string[] {
  const output: string[] = [];
  const stack: string[] = [];
  for (const t of tokens) {
    if (/^[0-9.]+$/.test(t) || t in CONSTANTS) {
      output.push(t);
    } else if (t in PRECEDENCE) {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        if (top === "(") break;
        const p1 = PRECEDENCE[t]!;
        const p2 = PRECEDENCE[top]!;
        if (p2 > p1 || (p2 === p1 && !RIGHT_ASSOC.has(t))) {
          output.push(stack.pop()!);
        } else break;
      }
      stack.push(t);
    } else if (t === "(") {
      stack.push(t);
    } else if (t === ")") {
      while (stack.length && stack[stack.length - 1] !== "(") output.push(stack.pop()!);
      if (stack.pop() !== "(") throw new Error("mismatched parens");
    } else {
      throw new Error(`unknown token ${t}`);
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top === "(" || top === ")") throw new Error("mismatched parens");
    output.push(top);
  }
  return output;
}

function evalRpn(rpn: string[]): number {
  const stack: number[] = [];
  for (const t of rpn) {
    if (/^[0-9.]+$/.test(t)) {
      stack.push(parseFloat(t));
    } else if (t in CONSTANTS) {
      stack.push(CONSTANTS[t]!);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("malformed expression");
      switch (t) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
        case "%": stack.push(a % b); break;
        case "**": stack.push(a ** b); break;
        default: throw new Error(`unknown op ${t}`);
      }
    }
  }
  if (stack.length !== 1) throw new Error("malformed expression");
  return stack[0]!;
}

function evaluate(expr: string): number {
  return evalRpn(toRpn(tokenize(expr)));
}
