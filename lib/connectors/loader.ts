/**
 * Connector registry — consumes the static registry in `connectors/registry.ts`.
 *
 * Why static instead of folder-scan?
 *   Turbopack (and webpack, and esbuild) cannot trace `import(variable)` and
 *   refuses to compile such expressions. The static-import file solves this
 *   while keeping the developer experience of "drop a folder, edit one line".
 *
 * The loader still scans the filesystem for the optional `prompt.md` file
 * because that's a runtime read, not a module import — safe under any bundler.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConnectorManifestSchema } from "@/lib/types";
import type { ConnectorHandler, ConnectorManifest, ToolDescriptor } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { BUILT_IN_CONNECTORS } from "@/connectors/registry";

const log = createLogger("connectors");

export type RegisteredConnector = {
  manifest: ConnectorManifest;
  handler: ConnectorHandler;
  prompt?: string;
  dir: string;
};

let registryPromise: Promise<Map<string, RegisteredConnector>> | null = null;

const CONNECTORS_DIR = path.join(process.cwd(), "connectors");

async function buildRegistry(): Promise<Map<string, RegisteredConnector>> {
  const map = new Map<string, RegisteredConnector>();

  for (const entry of BUILT_IN_CONNECTORS) {
    try {
      // Validate the manifest at boot — surfaces drift between manifest.json and the schema.
      const parsed = ConnectorManifestSchema.parse(entry.manifest);

      if (typeof entry.handler !== "function") {
        log.warn(`connector ${entry.dir}: handler is not a function`);
        continue;
      }

      // Optional runtime read of prompt.md — keeps prompt authoring in markdown.
      let prompt: string | undefined;
      try {
        prompt = await readFile(path.join(CONNECTORS_DIR, entry.dir, "prompt.md"), "utf8");
      } catch {
        // optional — no prompt is fine
      }

      map.set(parsed.name, {
        manifest: parsed,
        handler: entry.handler,
        prompt,
        dir: entry.dir,
      });
      log.info(`registered connector ${parsed.name}@${parsed.version}`);
    } catch (e) {
      log.warn(`skipping ${entry.dir}`, e);
    }
  }

  return map;
}

export async function getRegistry(): Promise<Map<string, RegisteredConnector>> {
  if (!registryPromise) registryPromise = buildRegistry();
  return registryPromise;
}

/** Reload the registry (used by `/api/connectors/list` in dev). */
export function invalidateRegistry(): void {
  registryPromise = null;
}

/** Format registered connectors as OpenAI/Anthropic-compatible tool descriptors. */
export async function listTools(): Promise<ToolDescriptor[]> {
  const reg = await getRegistry();
  return [...reg.values()].map(({ manifest }) => ({
    name: manifest.name,
    description: manifest.description,
    parameters: manifest.parameters,
  }));
}

/** Resolve and run a connector by name. */
export async function runConnector(
  name: string,
  args: unknown,
  ctx: import("@/lib/types").ConnectorContext,
): Promise<import("@/lib/types").ConnectorResult> {
  const reg = await getRegistry();
  const entry = reg.get(name);
  if (!entry) {
    return { ok: false, error: `Unknown connector: ${name}` };
  }
  try {
    return await entry.handler(args, ctx);
  } catch (e) {
    log.error(`connector ${name} threw`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: false };
  }
}
