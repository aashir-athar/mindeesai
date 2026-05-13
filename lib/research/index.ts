/**
 * Public research API.
 *
 * `research(query)` = search → take top N → crawl → rerank → return citations.
 * This is the single function the orchestrator calls when the LLM asks for
 * "look this up online".
 */

import type { Citation, ResearchHit } from "@/lib/types";
import { searchWeb } from "./search";
import { readPages } from "./crawl";
import { rerank } from "./rerank";
import { createLogger } from "@/lib/logger";
import { rememberMany } from "@/lib/memory/lancedb";
import { nid, isoNow } from "@/lib/utils";

const log = createLogger("research");

export type ResearchResult = {
  query: string;
  hits: ResearchHit[];
  passages: Array<{ url: string; title?: string; passage: string; score: number }>;
  citations: Citation[];
};

const PASSAGE_LEN = 1200;

export async function research(query: string, signal?: AbortSignal): Promise<ResearchResult> {
  const hits = await searchWeb(query, signal);
  if (hits.length === 0) {
    return { query, hits: [], passages: [], citations: [] };
  }

  const topUrls = hits.slice(0, 5).map((h) => h.url);
  log.info(`crawling ${topUrls.length} pages for "${query}"`);
  const pages = await readPages(topUrls, 3, signal);

  // chunk each page into PASSAGE_LEN-char windows
  const chunks = pages.flatMap((p) =>
    chunkText(p.text, PASSAGE_LEN).map((passage) => ({
      url: p.url,
      title: p.title,
      passage,
    })),
  );

  const ranked = await rerank(query, chunks.map((c) => ({ title: c.title ?? "", snippet: c.passage, ref: c })), 8);
  const passages = ranked.map((r) => ({
    url: r.ref!.url,
    title: r.ref!.title,
    passage: r.ref!.passage,
    score: r.rerankScore,
  }));

  const citations: Citation[] = passages.map((p) => ({
    title: p.title ?? p.url,
    url: p.url,
    snippet: p.passage.slice(0, 280),
    source: "web",
  }));

  // Side-effect: stash passages in long-term memory so the next conversation
  // doesn't need to re-crawl them.
  await rememberMany(
    passages.map((p) => ({
      id: nid(),
      text: p.passage,
      tags: ["research", new URL(p.url).hostname],
      source: "research",
      createdAt: isoNow(),
    })),
  );

  return { query, hits, passages, citations };
}

function chunkText(text: string, size: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
