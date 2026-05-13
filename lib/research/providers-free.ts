/**
 * Free, key-less research providers.
 *
 * The paid providers (Tavily, Exa, Firecrawl, Jina) are great but the user
 * may not have keys configured. These providers are the always-available
 * fallback so Mindees can ALWAYS research — even on a fresh fork with
 * zero env configuration.
 *
 *   - Wikipedia REST API     (search + summary, no key)
 *   - DuckDuckGo HTML        (search-result scraping, no key)
 *   - arXiv API              (academic search, no key)
 *
 * Returns the same ResearchHit shape as the paid providers so the
 * upstream rotation logic can mix them transparently.
 */

import type { ResearchHit } from "@/lib/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("research:free");

// ─── Wikipedia ─────────────────────────────────────────────────────────────

interface WikiSearchHit {
  title: string;
  description?: string;
  excerpt?: string;
}

export async function searchWikipedia(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const url = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=6`;
    const res = await fetch(url, {
      signal,
      headers: { "User-Agent": "MindeesAI-Research/1.0 (https://mindeesai.vercel.app)" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { pages?: WikiSearchHit[] };
    return (data.pages ?? []).map((p) => ({
      title: p.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      snippet: stripHtml(p.excerpt || p.description || ""),
      source: "wikipedia" as const,
    }));
  } catch (e) {
    log.warn("wiki search error", e);
    return [];
  }
}

// ─── arXiv ─────────────────────────────────────────────────────────────────
// arXiv returns Atom XML. We parse the minimum we need with regex —
// keeping deps zero. Good enough for titles + summaries + links.

export async function searchArxiv(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5&sortBy=relevance`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    return entries.map((e) => {
      const title = unxml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? "").trim();
      const summary = unxml(/<summary>([\s\S]*?)<\/summary>/.exec(e)?.[1] ?? "").trim();
      const link = /<id>([\s\S]*?)<\/id>/.exec(e)?.[1] ?? "";
      const published = /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] ?? "";
      return {
        title,
        url: link,
        snippet: summary.slice(0, 600),
        source: "arxiv" as const,
        publishedAt: published,
      };
    }).filter((h) => h.title && h.url);
  } catch (e) {
    log.warn("arxiv search error", e);
    return [];
  }
}

// ─── DuckDuckGo HTML ───────────────────────────────────────────────────────
// DDG's lite HTML endpoint is the standard "no-key generic web search"
// fallback. Scraping is fragile but works for the small volumes a cron
// tick will ever fire. If it breaks, the Wikipedia + arXiv path still
// provides results for most informational queries.

export async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MindeesAI/1.0)",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: ResearchHit[] = [];
    // <a class="result__a" href="URL">TITLE</a>
    const linkRe = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    // <a class="result__snippet" ...>SNIPPET</a>
    const snipRe = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const links = Array.from(html.matchAll(linkRe)).slice(0, 8);
    const snips = Array.from(html.matchAll(snipRe)).slice(0, 8);
    for (let i = 0; i < links.length; i++) {
      const rawUrl = links[i]?.[1] ?? "";
      const url = unwrapDDG(rawUrl);
      const title = stripHtml(links[i]?.[2] ?? "").trim();
      const snippet = stripHtml(snips[i]?.[1] ?? "").trim();
      if (!url || !title) continue;
      out.push({ title, url, snippet, source: "duckduckgo" });
    }
    return out;
  } catch (e) {
    log.warn("ddg error", e);
    return [];
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function unxml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function unwrapDDG(raw: string): string {
  // DDG sometimes wraps results as /l/?uddg=ENCODED_URL
  if (raw.startsWith("//duckduckgo.com/l/?uddg=")) {
    try {
      const u = new URL("https:" + raw);
      return decodeURIComponent(u.searchParams.get("uddg") || "");
    } catch { return raw; }
  }
  if (raw.startsWith("/l/?uddg=")) {
    try {
      const u = new URL("https://duckduckgo.com" + raw);
      return decodeURIComponent(u.searchParams.get("uddg") || "");
    } catch { return raw; }
  }
  return raw;
}
