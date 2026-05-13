/**
 * Web search abstraction.
 *
 * Provider order: Tavily → Exa → "no-op" (returns []).
 * Every provider returns the same `ResearchHit[]` shape so callers don't care.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { ResearchHit } from "@/lib/types";
import { searchWikipedia, searchArxiv, searchDuckDuckGo } from "./providers-free";

const log = createLogger("search");

async function searchTavily(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.TAVILY_API_KEY) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        search_depth: "advanced",
        max_results: 8,
        include_answer: false,
      }),
      signal,
    });
    if (!res.ok) {
      log.warn(`tavily ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }> };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      publishedAt: r.published_date,
    }));
  } catch (e) {
    log.warn("tavily error", e);
    return [];
  }
}

/** JINA Reader's search endpoint — s.jina.ai/<query>.
 *  Returns text/markdown of the top results. Free tier without key; better
 *  rate limit with key. We parse the markdown to recover (title, url, snippet). */
async function searchJina(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "MindeesAI-Research/1.0 (https://mindeesai.vercel.app)",
    };
    if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers,
      signal,
    });
    if (!res.ok) {
      log.warn(`jina ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      data?: Array<{ title?: string; url?: string; description?: string; content?: string }>;
    };
    return (data.data ?? []).slice(0, 8).map((r) => ({
      title: r.title ?? r.url ?? "(no title)",
      url: r.url ?? "",
      snippet: (r.description ?? r.content ?? "").slice(0, 600),
      source: "jina",
    })).filter((h) => h.url);
  } catch (e) {
    log.warn("jina error", e);
    return [];
  }
}

async function searchExa(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.EXA_API_KEY) return [];
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": env.EXA_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: 8,
        useAutoprompt: true,
      }),
      signal,
    });
    if (!res.ok) {
      log.warn(`exa ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { results?: Array<{ title: string; url: string; text?: string; score?: number; publishedDate?: string }> };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text ?? "",
      score: r.score,
      publishedAt: r.publishedDate,
    }));
  } catch (e) {
    log.warn("exa error", e);
    return [];
  }
}

/**
 * Returns the first non-empty provider's results.
 *
 * Rotation order:
 *   1. Tavily       (paid, best general web — when key present)
 *   2. Exa          (paid, semantic-search — when key present)
 *   3. JINA         (free tier w/o key, better with — semantic markdown summaries)
 *   4. DuckDuckGo   (FREE, generic web fallback — always available)
 *   5. Wikipedia    (FREE, authoritative knowledge — always available)
 *
 * arXiv is exposed separately via searchAcademic() for academic queries;
 * Reddit/HackerNews via searchSocial() for "what are real humans saying".
 */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  const tav = await searchTavily(query, signal);
  if (tav.length > 0) return tav.map((h) => ({ ...h, source: h.source ?? "tavily" }));
  const exa = await searchExa(query, signal);
  if (exa.length > 0) return exa.map((h) => ({ ...h, source: h.source ?? "exa" }));
  const jin = await searchJina(query, signal);
  if (jin.length > 0) return jin;
  const ddg = await searchDuckDuckGo(query, signal);
  if (ddg.length > 0) return ddg;
  return searchWikipedia(query, signal);
}

/** Multi-provider mixed search — pulls from all available providers in parallel. */
export async function searchWebMixed(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  const [tav, exa, jin, ddg, wiki] = await Promise.all([
    searchTavily(query, signal).then((r) => r.map((h) => ({ ...h, source: "tavily" }))),
    searchExa(query, signal).then((r) => r.map((h) => ({ ...h, source: "exa" }))),
    searchJina(query, signal),
    searchDuckDuckGo(query, signal),
    searchWikipedia(query, signal),
  ]);
  const all = [...tav, ...exa, ...jin, ...ddg, ...wiki];
  // Dedup by hostname+title
  const seen = new Set<string>();
  const dedup: ResearchHit[] = [];
  for (const h of all) {
    const k = `${new URL(h.url).hostname}::${h.title.toLowerCase().slice(0, 80)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(h);
  }
  return dedup;
}

/** Academic-focused search — arXiv. Used when the topic looks research-y. */
export async function searchAcademic(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  return searchArxiv(query, signal);
}

/** Social-search — what real humans on Reddit and HN are saying about a topic.
 *  Both endpoints are FREE, no key, JSON. Reddit needs a User-Agent or it 429s. */
export async function searchSocial(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  const [reddit, hn] = await Promise.all([
    searchReddit(query, signal),
    searchHackerNews(query, signal),
  ]);
  return [...reddit, ...hn];
}

async function searchReddit(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=8&sort=relevance`;
    const res = await fetch(url, {
      signal,
      headers: { "User-Agent": "MindeesAI-Research/1.0 (https://mindeesai.vercel.app)" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { children?: Array<{ data?: { title?: string; permalink?: string; selftext?: string; url?: string; subreddit?: string; score?: number } }> };
    };
    return (data.data?.children ?? []).slice(0, 6).map((c) => ({
      title: `[r/${c.data?.subreddit ?? "?"}] ${c.data?.title ?? ""}`,
      url: c.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : (c.data?.url ?? ""),
      snippet: (c.data?.selftext ?? "").slice(0, 500),
      source: "reddit",
      score: c.data?.score,
    })).filter((h) => h.url && h.title);
  } catch (e) {
    log.warn("reddit error", e);
    return [];
  }
}

async function searchHackerNews(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=6`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits?: Array<{ title?: string; url?: string; story_text?: string; objectID?: string; points?: number; created_at?: string }>;
    };
    return (data.hits ?? []).map((h) => ({
      title: `[HN] ${h.title ?? ""}`,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: (h.story_text ?? "").slice(0, 500),
      source: "hackernews",
      score: h.points,
      publishedAt: h.created_at,
    })).filter((h) => h.url && h.title);
  } catch (e) {
    log.warn("hackernews error", e);
    return [];
  }
}
