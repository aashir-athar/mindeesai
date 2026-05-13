/**
 * Runtime path resolution.
 *
 * Why this file exists:
 *   On Vercel, `process.cwd()` returns `/var/task` — a **read-only** mount.
 *   Any attempt to `mkdir` or write under it fails with `ENOENT`. The only
 *   writable path inside a Vercel function is `/tmp/*`.
 *
 *   Locally (dev + self-host), we want paths under `./data` and `./checkpoints`
 *   so the user can inspect them with a file explorer.
 *
 * Resolution:
 *   - On Vercel (detected via `process.env.VERCEL`): writable dirs live under
 *     `/tmp/...`. The tokenizer dir stays at `process.cwd()/tokenizer` because
 *     it's read-only (shipped in the bundle).
 *   - Off Vercel: everything lives under `process.cwd()/...`.
 *
 *   Both can be overridden via env vars (`DATA_PATH`, `CHECKPOINTS_PATH`,
 *   `TOKENIZER_PATH`) for self-hosted setups with mounted volumes.
 */

import path from "node:path";

const IS_VERCEL = process.env.VERCEL === "1";

const DEFAULT_DATA = IS_VERCEL ? "/tmp/data" : path.join(process.cwd(), "data");
const DEFAULT_CHECKPOINTS = IS_VERCEL ? "/tmp/checkpoints" : path.join(process.cwd(), "checkpoints");
const DEFAULT_TOKENIZER = path.join(process.cwd(), "tokenizer"); // read-only, shipped in bundle

export const DATA_DIR = process.env.DATA_PATH ?? DEFAULT_DATA;
export const CHECKPOINTS_DIR = process.env.CHECKPOINTS_PATH ?? DEFAULT_CHECKPOINTS;
export const TOKENIZER_DIR = process.env.TOKENIZER_PATH ?? DEFAULT_TOKENIZER;

export const dataPath = (...segments: string[]) => path.join(DATA_DIR, ...segments);
export const checkpointPath = (...segments: string[]) => path.join(CHECKPOINTS_DIR, ...segments);
export const tokenizerPath = (...segments: string[]) => path.join(TOKENIZER_DIR, ...segments);
