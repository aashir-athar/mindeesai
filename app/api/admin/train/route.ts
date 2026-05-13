/**
 * POST /api/admin/train
 *
 * Fires the GitHub Actions pretrain workflow (workflow_dispatch) for the
 * current repo. Closes the bootstrap loop: instead of nav-to-GitHub →
 * Actions → Run workflow → wait, the user can press a button on /admin.
 *
 * Auth: CRON_SECRET-bearer (same as /api/admin/flags).
 *
 * Body:
 *   { githubToken: string,   // PAT with `actions:write` scope
 *     ref?: string,          // default: "main"
 *     inputs?: Record<string, string>   // workflow_dispatch inputs
 *   }
 *
 * The PAT is NOT stored server-side. It's passed through to GitHub once
 * per click and discarded. /admin keeps it in sessionStorage so it
 * survives reloads but evaporates on tab close.
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_OWNER = "aashir-athar";
const REPO_NAME = "mindeesai";
const WORKFLOW_FILE = "pretrain.yml";

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  return (req.headers.get("authorization") || "") === `Bearer ${env.CRON_SECRET}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { githubToken?: string; ref?: string; inputs?: Record<string, string> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const pat = body.githubToken;
  if (!pat || typeof pat !== "string" || pat.length < 20) {
    return NextResponse.json({
      ok: false,
      error: "githubToken missing or invalid",
      hint: "Create a fine-grained PAT at github.com/settings/tokens with Actions: Read & Write on this repo.",
    }, { status: 400 });
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const ref = body.ref || "main";
  const inputs = body.inputs || {};

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${pat}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref, inputs }),
    });
    // GitHub returns 204 No Content on success — no body
    if (res.status === 204) {
      return NextResponse.json({
        ok: true,
        message: "Workflow dispatched. Watch progress at:",
        url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`,
      });
    }
    const text = await res.text();
    return NextResponse.json({
      ok: false,
      status: res.status,
      error: `GitHub returned ${res.status}`,
      detail: text.slice(0, 600),
    }, { status: res.status === 401 || res.status === 403 ? 401 : 500 });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
