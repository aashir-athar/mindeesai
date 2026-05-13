/**
 * GET  /api/admin/flags   → current runtime flag values + their source
 * POST /api/admin/flags   → set a flag, e.g. { useNativeModel: true }
 *
 * Auth: requires Authorization: Bearer <CRON_SECRET> (the same secret used
 * by /api/cron/* — keeps the admin surface gated without inventing a new
 * auth model). In dev (no CRON_SECRET) the endpoint is open.
 */

import { NextResponse } from "next/server";
import { effectiveFlags, setFlag } from "@/lib/runtime-flags";
import { env } from "@/lib/env";
import { existsSync } from "node:fs";
import { checkpointPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const flags = await effectiveFlags();
  return NextResponse.json({
    ok: true,
    flags,
    checkpoint_present: existsSync(checkpointPath("base.bin")),
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof body.useNativeModel === "boolean") {
    const next = await setFlag("useNativeModel", body.useNativeModel, "admin");
    return NextResponse.json({ ok: true, flags: next });
  }
  return NextResponse.json({ ok: false, error: "no known flag in body" }, { status: 400 });
}
