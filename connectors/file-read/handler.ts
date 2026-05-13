/**
 * file-read connector — bounded read inside `data/`.
 * Refuses any path that escapes the data directory.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { path: string };
const MAX_BYTES = 64 * 1024; // 64KB

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { path: rel } = args ?? ({} as Args);
  if (!rel) return { ok: false, error: "path required" };

  const dataDir = path.resolve(process.cwd(), "data");
  const target = path.resolve(dataDir, rel);
  if (!target.startsWith(dataDir + path.sep) && target !== dataDir) {
    return { ok: false, error: "path escapes data directory" };
  }

  try {
    const buf = await readFile(target);
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, error: `file exceeds ${MAX_BYTES} bytes` };
    }
    return { ok: true, output: { path: rel, text: buf.toString("utf8") } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export default handler;
