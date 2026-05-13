/**
 * web-crawl connector — fetches a single URL and returns readable text.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";
import { readPage } from "@/lib/research/crawl";

type Args = { url: string };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { url } = args ?? ({} as Args);
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, error: "absolute http(s) URL required" };
  }
  ctx.logger.info(`web-crawl: ${url}`);
  const page = await readPage(url, ctx.signal);
  if (!page) return { ok: false, error: "page extraction failed", retryable: true };
  return {
    ok: true,
    output: page,
    citations: [{ title: page.title ?? page.url, url: page.url, snippet: page.text.slice(0, 280), source: "web" }],
  };
};

export default handler;
