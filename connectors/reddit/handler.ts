/**
 * reddit — public Reddit JSON endpoint. Free, no key. Reddit DOES require
 * a real User-Agent or it returns 429 / blocks the request.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string; subreddit?: string };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  const sub = args?.subreddit;
  const base = sub
    ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?restrict_sr=1`
    : `https://www.reddit.com/search.json`;
  const url = `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}&limit=8&sort=relevance`;

  try {
    const res = await ctx.fetch(url, {
      headers: { "User-Agent": "MindeesAI/1.0 (https://mindeesai.vercel.app)" },
      signal: ctx.signal,
    });
    if (!res.ok) return { ok: false, error: `reddit ${res.status}`, retryable: true };
    const data = (await res.json()) as {
      data?: { children?: Array<{ data?: { title?: string; subreddit?: string; selftext?: string; permalink?: string; score?: number; num_comments?: number; created_utc?: number } }> };
    };
    const items = (data.data?.children ?? []).slice(0, 6).map((c) => {
      const d = c.data;
      return {
        title: d?.title ?? "",
        subreddit: d?.subreddit,
        snippet: (d?.selftext ?? "").slice(0, 300),
        score: d?.score,
        comments: d?.num_comments,
        url: d?.permalink ? `https://www.reddit.com${d.permalink}` : "",
      };
    }).filter((i) => i.url && i.title);
    return {
      ok: true,
      output: { query, subreddit: sub, items },
      citations: items.map((i) => ({
        title: `[r/${i.subreddit}] ${i.title}`,
        url: i.url,
        snippet: i.snippet || `${i.score ?? 0} upvotes · ${i.comments ?? 0} comments`,
        source: "web" as const,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
