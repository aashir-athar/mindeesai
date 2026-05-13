/**
 * Page extraction.
 *
 * Provider order: Firecrawl → Jina Reader (no key needed) → plain fetch + cheerio.
 * Returns clean readable text suitable for LLM consumption.
 */

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { CrawledPage } from "@/lib/types";
import { withSignal } from "@/lib/utils";

const log = createLogger("crawl");

const FETCH_TIMEOUT_MS = 12_000;

async function viaFirecrawl(url: string, signal?: AbortSignal): Promise<CrawledPage | null> {
  if (!env.FIRECRAWL_API_KEY) return null;
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: combine(signal, FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { markdown?: string; metadata?: { title?: string } } };
    const text = data.data?.markdown;
    if (!text) return null;
    return {
      url,
      title: data.data?.metadata?.title,
      text,
      fetchedAt: new Date().toISOString(),
      tokens: Math.ceil(text.length / 4),
    };
  } catch (e) {
    log.warn("firecrawl error", e);
    return null;
  }
}

async function viaJina(url: string, signal?: AbortSignal): Promise<CrawledPage | null> {
  try {
    const target = `https://r.jina.ai/${url}`;
    const headers: Record<string, string> = { Accept: "text/markdown" };
    if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(target, { headers, signal: combine(signal, FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    return {
      url,
      text,
      fetchedAt: new Date().toISOString(),
      tokens: Math.ceil(text.length / 4),
    };
  } catch (e) {
    log.warn("jina error", e);
    return null;
  }
}

async function viaPlain(url: string, signal?: AbortSignal): Promise<CrawledPage | null> {
  try {
    const res = await fetch(url, {
      signal: combine(signal, FETCH_TIMEOUT_MS),
      headers: { "user-agent": "MindeesAI/0.1 (+https://github.com/aashir-athar/mindeesai)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    $("script, style, noscript, nav, footer, header, aside").remove();
    const title = $("title").first().text().trim() || undefined;
    const text = $("body").text().replace(/\s+/g, " ").trim();
    if (!text) return null;
    return {
      url,
      title,
      text,
      fetchedAt: new Date().toISOString(),
      tokens: Math.ceil(text.length / 4),
    };
  } catch (e) {
    log.warn("plain fetch error", e);
    return null;
  }
}

/** Best-effort page extraction. Returns null if every provider failed. */
export async function readPage(url: string, signal?: AbortSignal): Promise<CrawledPage | null> {
  return (
    (await viaFirecrawl(url, signal)) ??
    (await viaJina(url, signal)) ??
    (await viaPlain(url, signal))
  );
}

/** Read many pages with bounded concurrency. */
export async function readPages(urls: string[], concurrency = 3, signal?: AbortSignal): Promise<CrawledPage[]> {
  const out: CrawledPage[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      const url = urls[i];
      if (!url) continue;
      const page = await withSignal(readPage(url, signal), signal).catch(() => null);
      if (page) out.push(page);
    }
  });
  await Promise.all(workers);
  return out;
}

function combine(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  }
  ctrl.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
  return ctrl.signal;
}
