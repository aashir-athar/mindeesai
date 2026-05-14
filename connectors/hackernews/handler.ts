/**
 * hackernews — Algolia HN search API. Free, no key.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string; type?: "story" | "comment" | "all" };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  const t = args?.type ?? "story";
  const tag = t === "story" ? "story" : t === "comment" ? "comment" : "(story,comment)";
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${encodeURIComponent(tag)}&hitsPerPage=6`;
    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (!res.ok) return { ok: false, error: `hn ${res.status}`, retryable: true };
    const data = (await res.json()) as {
      hits?: Array<{ title?: string; url?: string; story_text?: string; comment_text?: string; objectID?: string; points?: number; num_comments?: number; created_at?: string; author?: string }>;
    };
    const items = (data.hits ?? []).slice(0, 6).map((h) => ({
      title: h.title ?? "(comment)",
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points,
      comments: h.num_comments,
      author: h.author,
      created_at: h.created_at,
      snippet: (h.story_text ?? h.comment_text ?? "").slice(0, 200),
    }));
    return {
      ok: true,
      output: { query, items },
      citations: items.filter((i) => i.url).map((i) => ({
        title: `[HN] ${i.title}`,
        url: i.url,
        snippet: i.snippet || `${i.points ?? 0} points · ${i.comments ?? 0} comments`,
        source: "web" as const,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
