/**
 * Researcher agent.
 *
 * Most "research" runs go through the `web-search` connector. This agent is
 * the *programmatic* entry point — used by scripts, the cron loop, and any
 * future "deep dive" workflow that wants research without a chat turn.
 */

import { research } from "@/lib/research";
import type { ResearchResult } from "@/lib/research";

export async function deepResearch(query: string, signal?: AbortSignal): Promise<ResearchResult> {
  return research(query, signal);
}

export type { ResearchResult };
