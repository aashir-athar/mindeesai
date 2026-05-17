/**
 * GET /api/inference-mode
 *
 * Tells the UI which brain is serving inference right now:
 *   - "native"               native transformer with loaded checkpoint
 *   - "cloud-bootstrap"      checkpoint present but flag off
 *   - "cloud-no-checkpoint"  no checkpoint OR runtime can't host the model
 *
 * Lightweight by design: this endpoint is polled by the chat top bar, so
 * it must respond fast on every runtime. It does NOT import the native
 * transformer module (`core/mindees-mind`) — that module is heavy and on
 * Cloudflare Workers will blow the per-request CPU budget (error 1102).
 *
 * Native checkpoint presence is reported as "unknown" on Workers because
 * there is no local FS and we don't want to do an HTTP HEAD to HF Hub
 * just for a UI indicator. The Workers deploy is always running in
 * cloud-bootstrap mode anyway (model inference happens via the LLM
 * router calling external providers).
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { effectiveFlags } from "@/lib/runtime-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * True iff this code is currently executing inside Cloudflare Workers.
 * navigator.userAgent === "Cloudflare-Workers" is set by workerd and
 * is the most reliable runtime tag — env vars vary by adapter.
 */
function isCloudflareWorkers(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
  } catch {
    return false;
  }
}

export async function GET() {
  const flags = await effectiveFlags().catch(() => ({
    useNativeModel: false,
    source: { useNativeModel: "default" as const },
  }));

  // On Workers, skip the heavy native check entirely. On Node runtimes,
  // do the lookup lazily inside a try so any failure also degrades cleanly.
  let checkpointExists = false;
  let variant: string | null = null;
  let probeError: string | null = null;

  if (!isCloudflareWorkers()) {
    try {
      const [{ getMind }, { existsSync }, { checkpointPath }] = await Promise.all([
        import("@/core/mindees-mind"),
        import("node:fs"),
        import("@/lib/paths"),
      ]);
      const { cfg } = await getMind();
      variant = cfg.variant;
      checkpointExists = existsSync(checkpointPath("base.bin"));
    } catch (e) {
      probeError = (e as Error)?.message ?? "probe failed";
    }
  }

  let mode: "native" | "cloud-bootstrap" | "cloud-no-checkpoint";
  let label: string;

  if (flags.useNativeModel && checkpointExists) {
    mode = "native";
    label = `Mindees Native (${variant ?? "unknown"})`;
  } else if (checkpointExists) {
    mode = "cloud-bootstrap";
    label = "Cloud (checkpoint present, native disabled by flag)";
  } else {
    mode = "cloud-no-checkpoint";
    label = `Cloud (${env.FAST_CHAT_MODEL ?? "Groq"} — bootstrap teacher)`;
  }

  return NextResponse.json({
    ok: true,
    mode,
    label,
    runtime: isCloudflareWorkers() ? "cloudflare-workers" : "node",
    flags: {
      USE_NATIVE_MODEL: flags.useNativeModel,
      USE_NATIVE_MODEL_source: flags.source.useNativeModel,
      checkpoint_present: checkpointExists,
    },
    variant,
    probeError,
  });
}
