/**
 * web-search connector — delegates to `lib/research`.
 *
 * Returns:
 *   { hits: [{title, url, snippet, score}, ...] } as ConnectorResult.output
 *   and the same set as `citations` so the UI renders them inline.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";
import { research } from "@/lib/research";
import { searchWeb } from "@/lib/research/search";

type Args = { query: string; depth?: "quick" | "deep" };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query, depth = "deep" } = args ?? ({} as Args);
  if (!query || query.trim().length < 2) {
    return { ok: false, error: "query is required" };
  }

  ctx.logger.info(`web-search(${depth}): ${query}`);

  if (depth === "quick") {
    const hits = await searchWeb(query, ctx.signal);
    return {
      ok: true,
      output: {
        query,
        hits: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet })),
      },
      citations: hits.map((h) => ({
        title: h.title,
        url: h.url,
        snippet: h.snippet,
        source: "web" as const,
      })),
    };
  }

  const result = await research(query, ctx.signal);
  return {
    ok: true,
    output: {
      query: result.query,
      passages: result.passages,
      hits: result.hits,
    },
    citations: result.citations,
  };
};

export default handler;
