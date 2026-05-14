#!/usr/bin/env node
/**
 * Generate Next.js favicon family from public/assets/mind-logo.png.
 *
 * Drops the resized variants where Next.js's App Router conventions
 * pick them up automatically (no <link> tags needed in layout.tsx):
 *
 *   app/icon.png          32x32 — modern favicon
 *   app/apple-icon.png    180x180 — iOS home screen
 *   public/favicon.ico    legacy fallback (also 32x32, generated via PNG-as-ICO)
 *
 * Re-run any time the source logo changes:
 *   node scripts/gen-favicons.mjs
 */

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const SRC = "public/assets/mind-logo.png";

if (!existsSync(SRC)) {
  console.error(`✗ source not found: ${SRC}`);
  process.exit(1);
}

await mkdir("app", { recursive: true });

const targets = [
  { out: "app/icon.png",       size: 32,  fit: "contain" },
  { out: "app/apple-icon.png", size: 180, fit: "contain" },
];

for (const t of targets) {
  await sharp(SRC)
    .resize(t.size, t.size, {
      fit: t.fit,
      // Logo PNG already has transparency; preserve it.
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(t.out);
  console.log(`✓ wrote ${t.out} (${t.size}x${t.size})`);
}

console.log("\nDone. Next.js will auto-serve these as:");
console.log("  <link rel='icon' href='/icon.png' />");
console.log("  <link rel='apple-touch-icon' href='/apple-icon.png' />");
console.log("\nRemove the explicit `icons` block from app/layout.tsx metadata —");
console.log("the App Router convention handles it from app/icon.png automatically.");
