/**
 * GET /api/inference-mode
 *
 * Tells the UI which brain is serving inference right now:
 *   - "native"           Mindees' own transformer with loaded checkpoint
 *   - "cloud-bootstrap"  the LLM router (Groq/Anthropic/etc.) — temporary teacher
 *   - "cloud-no-checkpoint"  native model exists in code but has no checkpoint yet
 *
 * Used by the chat top bar's "MODEL" indicator so you can see at a glance
 * whether Mindees has graduated.
 */

import { NextResponse } from "next/server";
import { getMind } from "@/core/mindees-mind";
import { existsSync } from "node:fs";
import { checkpointPath } from "@/lib/paths";
import { effectiveFlags } from "@/lib/runtime-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checkpointExists = existsSync(checkpointPath("base.bin"));
  const { cfg } = await getMind();
  const flags = await effectiveFlags();

  let mode: "native" | "cloud-bootstrap" | "cloud-no-checkpoint";
  let label: string;

  if (flags.useNativeModel && checkpointExists) {
    mode = "native";
    label = `Mindees Native (${cfg.variant})`;
  } else if (checkpointExists) {
    mode = "cloud-bootstrap";
    label = "Cloud (checkpoint present, native disabled by flag)";
  } else {
    mode = "cloud-no-checkpoint";
    label = "Cloud (Groq / Llama-3.3 — bootstrap teacher)";
  }

  return NextResponse.json({
    ok: true,
    mode,
    label,
    flags: {
      USE_NATIVE_MODEL: flags.useNativeModel,
      USE_NATIVE_MODEL_source: flags.source.useNativeModel,
      checkpoint_present: checkpointExists,
    },
    variant: cfg.variant,
  });
}
