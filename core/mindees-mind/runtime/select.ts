/**
 * Runtime backend selection.
 *
 * Order of preference:
 *   1. WebGPU (browser or Node with @webgpu/types polyfill)
 *   2. WASM SIMD (when `wasm-feature-detect` reports support)
 *   3. Pure JS CPU (this file's `cpu.ts`)
 *
 * Today the project ships only the CPU backend. The other backends are wired
 * up via this selector so swapping is a single-line change once their kernels
 * land. The architecture exists so contributors can land them incrementally.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("runtime");

export type Backend = "webgpu" | "wasm" | "cpu";

let resolved: Backend | null = null;

export async function selectBackend(): Promise<Backend> {
  if (resolved) return resolved;
  // WebGPU
  try {
    const nav = (typeof navigator !== "undefined" ? (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }) : undefined);
    if (nav?.gpu) {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        resolved = "webgpu";
        log.info("backend: webgpu");
        return resolved;
      }
    }
  } catch {
    // ignore — fall through
  }

  // WASM is a placeholder until the kernels land.
  resolved = "cpu";
  log.info("backend: cpu");
  return resolved;
}

export function activeBackend(): Backend | null {
  return resolved;
}
