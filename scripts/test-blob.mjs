#!/usr/bin/env node
/**
 * One-shot Vercel Blob diagnostic.
 *
 * Reads BLOB_READ_WRITE_TOKEN from .env.local, then:
 *   1. put()  a tiny test file
 *   2. list() the test prefix
 *   3. del()  the test file
 *
 * Surfaces the exact error message at every step. Use this when the
 * cron loop shows `0 up / N fail` and you need to know whether the
 * token, the network, or the SDK is to blame.
 *
 * Usage:
 *   node scripts/test-blob.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]):/, "$1:"), "..");
const ENV_PATH = path.join(REPO_ROOT, ".env.local");

function loadToken() {
  let raw;
  try { raw = readFileSync(ENV_PATH, "utf8"); }
  catch { throw new Error(`Cannot read ${ENV_PATH} — run from repo root.`); }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*BLOB_READ_WRITE_TOKEN\s*=\s*(.+?)\s*$/);
    if (m) {
      let v = m[1].trim();
      // Strip optional surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  throw new Error(`BLOB_READ_WRITE_TOKEN= not found in ${ENV_PATH}`);
}

async function main() {
  const token = loadToken();
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is empty");
  console.log(`Token loaded: ${token.slice(0, 24)}…${token.slice(-6)} (${token.length} chars)`);
  if (!token.startsWith("vercel_blob_rw_")) {
    console.warn(`⚠  Token does not start with "vercel_blob_rw_" — Vercel Blob R/W tokens normally do.`);
  }

  const { put, list, del } = await import("@vercel/blob");

  const testKey = `_diagnostic/test-${Date.now()}.txt`;
  const testBody = `mindeesai blob diagnostic @ ${new Date().toISOString()}\n`;

  console.log(`\n[1/3] put() → ${testKey}`);
  let blob;
  try {
    blob = await put(testKey, testBody, {
      access: "public",
      token,
      allowOverwrite: true,
    });
    console.log(`     ✓ uploaded → ${blob.url}`);
  } catch (e) {
    console.error(`     ✗ FAILED: ${e?.message ?? e}`);
    if (e?.cause) console.error(`        cause: ${e.cause?.message ?? e.cause}`);
    process.exit(2);
  }

  console.log(`\n[2/3] list() prefix=_diagnostic/`);
  try {
    const { blobs } = await list({ prefix: "_diagnostic/", token });
    console.log(`     ✓ listed ${blobs.length} blob(s) under _diagnostic/`);
    for (const b of blobs.slice(0, 5)) console.log(`        - ${b.pathname} (${b.size} bytes)`);
  } catch (e) {
    console.error(`     ✗ FAILED: ${e?.message ?? e}`);
  }

  console.log(`\n[3/3] del() → ${blob.url}`);
  try {
    await del(blob.url, { token });
    console.log(`     ✓ deleted`);
  } catch (e) {
    console.error(`     ✗ del FAILED (non-fatal): ${e?.message ?? e}`);
  }

  console.log(`\n✓ Vercel Blob credentials are working. The cron's blob failures must have another cause — re-run the cron and inspect the 'reason' field for the per-file error.`);
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});
