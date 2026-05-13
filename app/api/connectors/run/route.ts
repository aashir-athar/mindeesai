/**
 * POST /api/connectors/run
 *
 * Manually invoke a connector — useful for the "Skills playground" UI and
 * for scripted testing.
 *
 * Request:  { name: string, args: unknown }
 * Response: ConnectorResult
 */

import { NextRequest, NextResponse } from "next/server";
import { runConnector, getRegistry } from "@/lib/connectors/loader";
import { buildContext } from "@/lib/connectors/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { name?: string; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.name) return NextResponse.json({ ok: false, error: "missing name" }, { status: 400 });

  const reg = await getRegistry();
  const entry = reg.get(body.name);
  if (!entry) return NextResponse.json({ ok: false, error: `unknown connector ${body.name}` }, { status: 404 });

  const ctrl = new AbortController();
  req.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  const ctx = buildContext(entry.manifest, ctrl.signal);

  const result = await runConnector(body.name, body.args ?? {}, ctx);
  return NextResponse.json(result);
}
