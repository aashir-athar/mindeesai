/**
 * wikipedia — REST-API summary lookup. Free, no key.
 *
 * Two-step:
 *   1. /w/rest.php/v1/search/page → top hit (title resolution)
 *   2. /api/rest_v1/page/summary/<title> → article extract + thumbnail
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  const ua = "MindeesAI/1.0 (https://mindeesai.vercel.app)";
  try {
    const searchUrl = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`;
    const searchRes = await ctx.fetch(searchUrl, { headers: { "User-Agent": ua }, signal: ctx.signal });
    if (!searchRes.ok) return { ok: false, error: `wiki search ${searchRes.status}`, retryable: true };
    const searchData = (await searchRes.json()) as { pages?: Array<{ key?: string; title?: string }> };
    const top = searchData.pages?.[0];
    if (!top?.key || !top.title) return { ok: false, error: `no Wikipedia article matches "${query}"` };

    const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top.key)}`;
    const sumRes = await ctx.fetch(sumUrl, { headers: { "User-Agent": ua }, signal: ctx.signal });
    if (!sumRes.ok) return { ok: false, error: `wiki summary ${sumRes.status}`, retryable: true };
    const sum = (await sumRes.json()) as {
      title: string;
      description?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    const url = sum.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(top.key)}`;
    return {
      ok: true,
      output: {
        title: sum.title,
        description: sum.description,
        extract: sum.extract,
        url,
      },
      citations: [
        { title: sum.title, url, snippet: (sum.extract ?? "").slice(0, 300), source: "web" as const },
      ],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
