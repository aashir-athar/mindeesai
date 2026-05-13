/**
 * Web search abstraction.
 *
 * Provider order: Tavily → Exa → "no-op" (returns []).
 * Every provider returns the same `ResearchHit[]` shape so callers don't care.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { ResearchHit } from "@/lib/types";

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

/** Returns the first non-empty provider's results. */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  if (!env.ENABLE_WEB_RESEARCH) return [];
  const tav = await searchTavily(query, signal);
  if (tav.length > 0) return tav;
  return searchExa(query, signal);
}
