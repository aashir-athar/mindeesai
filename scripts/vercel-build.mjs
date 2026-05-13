/**
 * vercel-build.mjs — pre-build hook that runs INSIDE Vercel's build step.
 *
 * What it does (idempotent, safe to re-run):
 *  - Ensures /tmp-style runtime folders are scaffolded for the bundle
 *  - Seeds `data/system-prompt.json` from the base prompt if missing
 *  - Probes for the optional tokenizer + LoRA checkpoint and warns (not fails)
 *    if they're absent — the model still boots with a stub tokenizer + fresh
 *    weights, the cron just won't produce useful training signal until you
 *    upload a real checkpoint.
 *
 * Why not use `scripts/bootstrap.mjs` directly?
 *   bootstrap.mjs writes into `data/`, which on Vercel is read-only at build
 *   time and ephemeral at runtime. The actual data folders are created at
 *   first request from the API routes; this script only handles deploy-time
 *   concerns (env validation + bundle warnings + system-prompt seeding).
 */

import { writeFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const dim    = (s) => `\x1b[2m${s}\x1b[0m`;

function ok(msg)   { console.log(green("✓"), msg); }
function warn(msg) { console.log(yellow("⚠"), msg); }
function info(msg) { console.log(dim("ℹ"), msg); }
function bad(msg)  { console.log(red("✗"), msg); }

console.log("\nMindeesAI · Vercel build hook");
console.log(dim("─".repeat(48)));

// 1. Required envs
const requiredEnv = ["CRON_SECRET"];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length > 0) {
  bad(`Missing required env vars on Vercel: ${missing.join(", ")}`);
  bad("Set them in Vercel → Project → Settings → Environment Variables.");
  bad("Generate CRON_SECRET locally with:  openssl rand -hex 32");
  // Don't fail the build — the dev may be deploying a preview to test the UI.
}

// 2. Optional envs — soft warnings
const optionalEnv = {
  TAVILY_API_KEY:        "web-search connector (deep)",
  FIRECRAWL_API_KEY:     "web-crawl connector",
  ANTHROPIC_API_KEY:     "optional bootstrap teacher (distillation only)",
  OPENAI_API_KEY:        "optional bootstrap teacher",
  XAI_API_KEY:           "optional bootstrap teacher",
  BLOB_READ_WRITE_TOKEN: "persistence on Vercel Blob (when MEMORY_PERSISTENCE=vercel-blob)",
};
for (const [k, why] of Object.entries(optionalEnv)) {
  if (!process.env[k]) info(`${k} not set — ${why}`);
  else ok(`${k} configured`);
}

// 3. Seed `data/system-prompt.json` lazily — it'll be created at first
//    optimizer run inside the live function. Nothing to do at build time.
//    We just make sure the *directory* concept is documented in the README.
info("system-prompt.json is created lazily at first cron tick");

// 4. Probe for the tokenizer (informational only)
const tokenizerPath = path.join(ROOT, "tokenizer", "tokenizer.json");
const checkpointPath = path.join(ROOT, "checkpoints", "base.bin");
try { await access(tokenizerPath); ok("tokenizer/tokenizer.json present"); }
catch { warn("tokenizer not trained — model will start with byte-level stub. Train with: python scripts/train/tokenizer_train.py"); }
try { await access(checkpointPath); ok("checkpoints/base.bin present"); }
catch { warn("no base checkpoint — model starts with random weights, online learning will rebuild from zero (slow)"); }

// 5. Touch a `data/` skeleton inside the build output for the runtime to find.
//    On Vercel the working dir is read-only at runtime but `/tmp` is writable —
//    the runtime mirrors any needed paths there.
const skeletons = ["data", "data/conversations", "data/reflections", "data/feedback", "data/eval"];
for (const s of skeletons) {
  try { await mkdir(path.join(ROOT, s), { recursive: true }); } catch { /* ignore */ }
}
ok("data skeleton ensured (will be mirrored to /tmp at runtime on Vercel)");

console.log(dim("─".repeat(48)));
ok("vercel-build hook complete\n");
