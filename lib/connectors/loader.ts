/**
 * Connector discovery + registry.
 *
 * On boot (and on every cold start of a serverless function), we walk
 * `/connectors/*`, validate manifests, and dynamically import handlers.
 * The result is a `Registry` keyed by connector name.
 *
 * Production note: in a long-lived process, this registry is cached forever.
 * On Vercel each function instance loads it once and reuses it.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConnectorManifestSchema } from "@/lib/types";
import type { ConnectorHandler, ConnectorManifest, ToolDescriptor } from "@/lib/types";
import { createLogger } from "@/lib/logger";

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
  try {
    const entries = await readdir(CONNECTORS_DIR);
    for (const name of entries) {
      const dir = path.join(CONNECTORS_DIR, name);
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) continue;

        const manifestRaw = await readFile(path.join(dir, "manifest.json"), "utf8");
        const parsed = ConnectorManifestSchema.parse(JSON.parse(manifestRaw));

        const handlerPath = pathToFileURL(path.join(dir, "handler.ts")).href;
        // Fallback to .js (compiled) when running in production
        const importPath = await fileExists(handlerPath.replace("file://", "")) ? handlerPath : pathToFileURL(path.join(dir, "handler.js")).href;
        const mod = (await import(importPath)) as { default: ConnectorHandler };
        if (typeof mod.default !== "function") {
          log.warn(`connector ${name}: handler.ts missing default export`);
          continue;
        }

        let prompt: string | undefined;
        try {
          prompt = await readFile(path.join(dir, "prompt.md"), "utf8");
        } catch {
          // optional
        }

        map.set(parsed.name, { manifest: parsed, handler: mod.default, prompt, dir });
        log.info(`registered connector ${parsed.name}@${parsed.version}`);
      } catch (e) {
        log.warn(`skipping ${name}`, e);
      }
    }
  } catch (e) {
    log.warn("connectors directory missing", e);
  }
  return map;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
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
