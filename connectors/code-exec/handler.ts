/**
 * code-exec connector — runs JS in a sealed `node:vm` context.
 *
 * Hard guards:
 *  - no access to `process`, `require`, `import`, `fetch`
 *  - 1-second hard timeout
 *  - 256kb source cap
 *  - return value is JSON-stringified, truncated at 8kb
 *
 * NOT a full sandbox — `vm` is escape-prone with sufficient effort. For
 * production hardening switch to `isolated-vm` or a worker_threads bridge.
 */

import vm from "node:vm";
import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { code: string };
const MAX_CODE = 256 * 1024;
const TIMEOUT_MS = 1000;
const MAX_OUTPUT = 8 * 1024;

const handler: ConnectorHandler<Args> = async (args) => {
  const { code } = args ?? ({} as Args);
  if (!code) return { ok: false, error: "code required" };
  if (code.length > MAX_CODE) return { ok: false, error: "code too large" };

  // Strip imports/requires defensively (script also has no `require` in scope)
  if (/\b(require|import|fetch|process|globalThis|global)\b/.test(code)) {
    return { ok: false, error: "disallowed identifier in code" };
  }

  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.Math = Math;
  sandbox.JSON = JSON;
  sandbox.Date = Date;
  sandbox.console = { log: () => undefined };

  try {
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    const script = new vm.Script(`(()=>{ ${code} })()`);
    const result = script.runInContext(context, { timeout: TIMEOUT_MS, breakOnSigint: true });
    const text = JSON.stringify(result, null, 2) ?? String(result);
    return {
      ok: true,
      output: { result: text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + "…" : text },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export default handler;
