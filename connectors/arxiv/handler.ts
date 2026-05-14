/**
 * arxiv — academic search via the public Atom-feed API. Free, no key.
 *
 * http://export.arxiv.org/api/query?search_query=all:<terms>
 * Returns XML; we regex-parse out the entries we need (title, summary,
 * authors, link, published).
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string };

function unxml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=6&sortBy=relevance`;
    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (!res.ok) return { ok: false, error: `arxiv ${res.status}`, retryable: true };
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    const items = entries.map((e) => {
      const title = unxml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? "");
      const summary = unxml(/<summary>([\s\S]*?)<\/summary>/.exec(e)?.[1] ?? "");
      const id = /<id>([\s\S]*?)<\/id>/.exec(e)?.[1] ?? "";
      const published = /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] ?? "";
      const authors = Array.from(e.matchAll(/<name>([\s\S]*?)<\/name>/g)).slice(0, 5).map((m) => unxml(m[1] ?? ""));
      return { title, summary: summary.slice(0, 500), url: id, published, authors };
    }).filter((p) => p.title && p.url);
    return {
      ok: true,
      output: { query, items },
      citations: items.map((p) => ({
        title: p.title,
        url: p.url,
        snippet: p.summary.slice(0, 250),
        source: "web" as const,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
