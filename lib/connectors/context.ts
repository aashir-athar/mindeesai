/**
 * Builds the per-call ConnectorContext.
 *
 * Permissions are *checked* here: a connector that didn't declare `network`
 * gets a fetch that always rejects, etc.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { ConnectorContext, ConnectorManifest } from "@/lib/types";

export function buildContext(manifest: ConnectorManifest, signal: AbortSignal, user?: { id: string }): ConnectorContext {
  const log = createLogger(`conn:${manifest.name}`);
  const permitted = new Set(manifest.permissions ?? []);

  const guardedFetch: typeof fetch = (input, init) => {
    if (!permitted.has("network")) {
      return Promise.reject(new Error(`connector ${manifest.name} does not declare 'network' permission`));
    }
    const headers = new Headers(init?.headers);
    if (!headers.has("user-agent")) {
      headers.set("user-agent", `MindeesAI-Connector/${manifest.name}@${manifest.version}`);
    }
    return fetch(input as RequestInfo, { ...init, headers, signal: init?.signal ?? signal });
  };

  // Connector-visible env is a *filtered* view. By default, none.
  // To expose a secret, declare it as `secrets:VAR_NAME` in manifest.permissions.
  const exposedEnv: Record<string, string | undefined> = {};
  for (const p of manifest.permissions ?? []) {
    if (p.startsWith("secrets:")) {
      const key = p.slice("secrets:".length);
      exposedEnv[key] = process.env[key];
    }
  }
  // Common public env that every connector may read
  exposedEnv.NEXT_PUBLIC_SITE_URL = env.SITE_URL;

  return {
    fetch: guardedFetch,
    logger: log,
    env: exposedEnv,
    signal,
    user,
  };
}
