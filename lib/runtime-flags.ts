/**
 * Runtime-overridable feature flags.
 *
 * Env vars are read at process start; on serverless they're effectively
 * immutable per cold-boot. For flags we want to flip at runtime (e.g.
 * USE_NATIVE_MODEL once we've verified a checkpoint is sane) we keep a
 * tiny JSON file at data/runtime-flags.json that overrides env values.
 *
 * The orchestrator reads `effectiveFlags()` per turn, so flipping the
 * switch on the admin page takes effect on the next message.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { env } from "@/lib/env";

const FILE = dataPath("runtime-flags.json");

export interface RuntimeFlags {
  useNativeModel?: boolean;
  updatedAt?: string;
  updatedBy?: string; // "env" | "admin" | "cron"
}

let cache: { value: RuntimeFlags; loadedAt: number } | null = null;
const CACHE_TTL_MS = 4_000;

async function load(): Promise<RuntimeFlags> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as RuntimeFlags;
    cache = { value: parsed, loadedAt: now };
    return parsed;
  } catch {
    cache = { value: {}, loadedAt: now };
    return {};
  }
}

export async function effectiveFlags(): Promise<{
  useNativeModel: boolean;
  source: Record<string, "env" | "runtime-file">;
}> {
  const f = await load();
  return {
    useNativeModel: f.useNativeModel ?? env.USE_NATIVE_MODEL,
    source: {
      useNativeModel: f.useNativeModel !== undefined ? "runtime-file" : "env",
    },
  };
}

export async function setFlag(
  key: keyof RuntimeFlags,
  value: boolean,
  updatedBy = "admin",
): Promise<RuntimeFlags> {
  const current = await load();
  const next: RuntimeFlags = {
    ...current,
    [key]: value,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
    cache = { value: next, loadedAt: Date.now() };
  } catch {
    // best-effort — on a read-only FS the env-default still applies
  }
  return next;
}

export function invalidateRuntimeFlagsCache(): void {
  cache = null;
}
