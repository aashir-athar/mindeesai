/**
 * GET /api/connectors/list
 *
 * Returns the currently loaded connector registry — useful for the chat UI's
 * "Skills" panel and for debugging which connectors got picked up at boot.
 */

import { NextResponse } from "next/server";
import { getRegistry, invalidateRegistry } from "@/lib/connectors/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const reg = await getRegistry();
  return NextResponse.json({
    count: reg.size,
    connectors: [...reg.values()].map(({ manifest }) => ({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      permissions: manifest.permissions,
      author: manifest.author,
    })),
  });
}

/** Dev-only: POST to force a registry reload. */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 403 });
  }
  invalidateRegistry();
  return NextResponse.json({ ok: true, reloaded: true });
}
