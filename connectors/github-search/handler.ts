/**
 * github-search — public GitHub REST search. Unauthenticated, rate-limited
 * to ~10 req/min but FREE. No key required.
 *
 * Scopes:
 *   repositories — repo metadata (most useful default)
 *   code         — code snippets in files (requires auth in newer API;
 *                  unauth gets a 403 — we fall back to repo search)
 *   issues       — issues + PRs across the public corpus
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { query: string; scope?: "repositories" | "code" | "issues" };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { query } = args ?? ({} as Args);
  const scope = args?.scope ?? "repositories";
  if (!query || query.length > 200) {
    return { ok: false, error: "query required (≤ 200 chars)" };
  }
  try {
    const url = `https://api.github.com/search/${scope}?q=${encodeURIComponent(query)}&per_page=6`;
    const res = await ctx.fetch(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "MindeesAI/1.0",
      },
      signal: ctx.signal,
    });
    if (res.status === 403) {
      return { ok: false, error: "GitHub rate limit reached (unauthenticated: ~10 req/min). Try again in a minute.", retryable: true };
    }
    if (!res.ok) return { ok: false, error: `github ${res.status}`, retryable: true };
    const data = (await res.json()) as { items?: Array<Record<string, unknown>>; total_count?: number };
    const items = (data.items ?? []).slice(0, 6).map((it) => {
      if (scope === "repositories") {
        return {
          name: it.full_name,
          stars: it.stargazers_count,
          language: it.language,
          description: it.description,
          url: it.html_url,
        };
      }
      if (scope === "issues") {
        return {
          title: it.title,
          state: it.state,
          repo: ((it.repository_url as string) ?? "").replace("https://api.github.com/repos/", ""),
          url: it.html_url,
        };
      }
      return {
        path: it.path,
        repo: ((it.repository as Record<string, unknown>)?.full_name as string),
        url: it.html_url,
      };
    });
    return {
      ok: true,
      output: { total_count: data.total_count ?? 0, scope, items },
      citations: items.map((i) => ({
        title: String(i.name ?? i.title ?? i.path ?? "GitHub result"),
        url: String(i.url ?? ""),
        snippet: String((i as Record<string, unknown>).description ?? "").slice(0, 200),
        source: "web" as const,
      })).filter((c) => c.url),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
