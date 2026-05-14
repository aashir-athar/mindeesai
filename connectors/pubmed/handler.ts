/**
 * pubmed — NCBI E-utilities. Free, no key, ~3 req/sec rate limit.
 *
 * Two-step:
 *   1. esearch.fcgi → list of PMIDs matching the query
 *   2. esummary.fcgi → title, authors, journal, year for each PMID
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=6&sort=relevance`;
    const searchRes = await ctx.fetch(searchUrl, { signal: ctx.signal });
    if (!searchRes.ok) return { ok: false, error: `pubmed search ${searchRes.status}`, retryable: true };
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return { ok: true, output: { query, items: [] } };

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const summaryRes = await ctx.fetch(summaryUrl, { signal: ctx.signal });
    if (!summaryRes.ok) return { ok: false, error: `pubmed summary ${summaryRes.status}`, retryable: true };
    const summaryData = (await summaryRes.json()) as { result?: Record<string, unknown> };
    const items = ids.map((id) => {
      const r = summaryData.result?.[id] as {
        title?: string;
        authors?: Array<{ name: string }>;
        source?: string;
        pubdate?: string;
      } | undefined;
      if (!r) return null;
      return {
        pmid: id,
        title: r.title,
        authors: (r.authors ?? []).slice(0, 4).map((a) => a.name),
        journal: r.source,
        pubdate: r.pubdate,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      ok: true,
      output: { query, items },
      citations: items.map((i) => ({
        title: i.title ?? `PMID ${i.pmid}`,
        url: i.url,
        snippet: `${i.authors.join(", ")} · ${i.journal} · ${i.pubdate}`,
        source: "web" as const,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
