/**
 * One-shot bootstrap script — run before `pnpm dev` for the first time.
 *
 * What it does:
 *  - Creates `data/` subdirectories
 *  - Writes a seed `data/system-prompt.json` from `lib/prompts/base.ts`
 *  - Probes for tokenizer + LoRA checkpoint; prints next-steps if missing
 *
 * Safe to re-run. Idempotent on every step.
 */

import { mkdir, stat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

const dirs = [
  "data",
  "data/conversations",
  "data/reflections",
  "data/system-prompt-archive",
  "data/cache",
  "data/feedback",
  "data/lancedb",
  "checkpoints",
  "tokenizer",
];

for (const d of dirs) {
  await mkdir(path.join(ROOT, d), { recursive: true });
  console.log("ensured", d);
}

// Seed system prompt
const promptFile = path.join(ROOT, "data", "system-prompt.json");
try {
  await stat(promptFile);
} catch {
  const seed = await import("../lib/prompts/base.ts").then((m) => m.SEED_SYSTEM_PROMPT).catch(() => null);
  if (seed) {
    await writeFile(promptFile, JSON.stringify({ prompt: seed, updatedAt: Date.now(), id: "seed" }, null, 2), "utf8");
    console.log("seeded", promptFile);
  } else {
    console.log("(skipping seed prompt — run `pnpm dev` once to compile lib/prompts/base.ts)");
  }
}

// Tokenizer check
try {
  await access(path.join(ROOT, "tokenizer", "tokenizer.json"));
  console.log("✓ tokenizer present");
} catch {
  console.log("⚠ tokenizer NOT trained. Run:");
  console.log("   python scripts/train/tokenizer_train.py --corpus scripts/data/corpus.txt --vocab-size 32000 --out tokenizer/tokenizer.json");
}

// Checkpoint check
try {
  await access(path.join(ROOT, "checkpoints", "base.bin"));
  console.log("✓ base checkpoint present");
} catch {
  console.log("⚠ no base checkpoint yet. Either:");
  console.log("   1) pretrain: python scripts/train/pretrain.py --variant small --corpus scripts/data/corpus.txt --steps 50000");
  console.log("   2) or skip — the system starts with randomly-initialised weights and improves online (slow).");
}

console.log("\nbootstrap complete.");
