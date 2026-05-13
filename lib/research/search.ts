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
 *   3. DuckDuckGo   (FREE, generic web fallback — always available)
 *   4. Wikipedia    (FREE, authoritative knowledge — always available)
 *
 * arXiv is exposed separately via searchAcademic() for queries where we
 * know we want papers, not general web.
 */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  const tav = await searchTavily(query, signal);
  if (tav.length > 0) return tav.map((h) => ({ ...h, source: h.source ?? "tavily" }));
  const exa = await searchExa(query, signal);
  if (exa.length > 0) return exa.map((h) => ({ ...h, source: h.source ?? "exa" }));
  const ddg = await searchDuckDuckGo(query, signal);
  if (ddg.length > 0) return ddg;
  return searchWikipedia(query, signal);
}

/** Multi-provider mixed search — pulls from all available providers in parallel. */
export async function searchWebMixed(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  const [tav, exa, ddg, wiki] = await Promise.all([
    searchTavily(query, signal).then((r) => r.map((h) => ({ ...h, source: "tavily" }))),
    searchExa(query, signal).then((r) => r.map((h) => ({ ...h, source: "exa" }))),
    searchDuckDuckGo(query, signal),
    searchWikipedia(query, signal),
  ]);
  const all = [...tav, ...exa, ...ddg, ...wiki];
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
