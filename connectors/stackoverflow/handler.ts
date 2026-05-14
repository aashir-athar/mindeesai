/**
 * stackoverflow — Stack Exchange API search. Free, no key (300 req/day
 * soft limit per IP).
 *
 * Endpoint: /2.3/search/advanced
 * Returns: list of questions with title, score, answer count, accepted-answer
 * id, link.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string; tag?: string };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  try {
    const params = new URLSearchParams({
      order: "desc",
      sort: "relevance",
      q: query,
      site: "stackoverflow",
      pagesize: "6",
      filter: "default",
    });
    if (args?.tag) params.set("tagged", args.tag);
    const url = `https://api.stackexchange.com/2.3/search/advanced?${params.toString()}`;
    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (!res.ok) return { ok: false, error: `stackexchange ${res.status}`, retryable: true };
    const data = (await res.json()) as {
      items?: Array<{
        title: string;
        link: string;
        score: number;
        answer_count: number;
        is_answered: boolean;
        accepted_answer_id?: number;
        tags?: string[];
      }>;
    };
    const items = (data.items ?? []).slice(0, 6).map((q) => ({
      title: q.title,
      url: q.link,
      score: q.score,
      answer_count: q.answer_count,
      is_answered: q.is_answered,
      has_accepted: !!q.accepted_answer_id,
      tags: q.tags,
    }));
    return {
      ok: true,
      output: { query, tag: args?.tag, items },
      citations: items.map((i) => ({
        title: i.title,
        url: i.url,
        snippet: `${i.score} votes · ${i.answer_count} answers${i.has_accepted ? " · ✓ accepted" : ""}`,
        source: "web" as const,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
