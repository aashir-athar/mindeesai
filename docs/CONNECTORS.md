# Adding a Connector (Skill) to MindeesAI

A **connector** is a self-contained skill that the AI can call as a tool. Adding one is **drop-a-folder simple** — no router changes, no registry edits.

---

## The 30-second version

```bash
mkdir -p connectors/my-skill
```

Create three files inside it:

**`connectors/my-skill/manifest.json`**
```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "description": "One sentence the LLM reads when deciding whether to use this tool.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "What to do." }
    },
    "required": ["query"]
  },
  "permissions": ["network"],
  "author": "your-name"
}
```

**`connectors/my-skill/handler.ts`**
```ts
import type { ConnectorContext, ConnectorResult } from "@/lib/connectors/types";

export default async function handler(
  args: { query: string },
  ctx: ConnectorContext
): Promise<ConnectorResult> {
  // Do work here. ctx exposes: ctx.fetch, ctx.logger, ctx.env, ctx.signal
  return {
    ok: true,
    output: { answer: `you said: ${args.query}` },
    citations: [],
  };
}
```

**`connectors/my-skill/prompt.md`** (optional)
```md
Use `my-skill` whenever the user asks for [specific scenario].
Never use it for [counter-example].
```

Restart `pnpm dev` and the connector is live. The orchestrator will list it as a tool the LLM can call.

---

## Handler contract

```ts
type ConnectorContext = {
  fetch: typeof fetch;           // pre-bound fetch with redirect + UA + timeout
  logger: { info: Fn; warn: Fn; error: Fn };
  env: Record<string, string | undefined>;
  signal: AbortSignal;           // honour this — long-running calls will be aborted
  user?: { id: string };         // present when authenticated
};

type ConnectorResult =
  | { ok: true;  output: unknown; citations?: Citation[]; tokens?: number }
  | { ok: false; error: string;   retryable?: boolean };
```

**Rules:**
1. **Honour `ctx.signal`** — pass it into every `fetch` or async loop.
2. **Return `citations`** for anything sourced from the web — the UI renders them inline.
3. **Never throw** for expected errors. Return `{ ok: false, error: "...", retryable: true }` and let the orchestrator decide.
4. **Validate `args`** with `zod` — the manifest schema is a hint, but the runtime should never trust it.

---

## Permissions

`manifest.json` declares what the connector needs. The runtime enforces them.

| Permission | Grants |
|---|---|
| `network` | Outbound HTTP via `ctx.fetch` |
| `filesystem-read` | `fs/promises#readFile` inside `data/` |
| `filesystem-write` | `fs/promises#writeFile` inside `data/` |
| `secrets:TAVILY_API_KEY` | Reads only the named env var |
| `child-process` | Subprocess execution (sandboxed; danger zone) |

A connector that declares no permissions runs in a sealed bubble.

---

## Testing your connector

```bash
pnpm vitest run tests/connectors/my-skill.test.ts
```

Skeleton test:

```ts
import { describe, it, expect } from "vitest";
import handler from "@/connectors/my-skill/handler";

describe("my-skill", () => {
  it("returns ok", async () => {
    const res = await handler(
      { query: "hello" },
      { fetch, logger: console, env: process.env, signal: new AbortController().signal }
    );
    expect(res.ok).toBe(true);
  });
});
```

---

## Built-in connectors (study these for patterns)

- **`web-search`** — Tavily-first, Exa fallback
- **`web-crawl`** — Firecrawl-first, Jina Reader fallback
- **`code-exec`** — sandboxed JS via `vm` module
- **`calculator`** — deterministic math (no LLM)
- **`file-read`** — bounded reads from `data/`
- **`reflect`** — invokes the reflector agent in-loop

---

## Publishing your connector

We welcome PRs that add high-quality, well-tested connectors. Open a PR with:

1. The `connectors/<name>/` folder
2. A test in `tests/connectors/<name>.test.ts`
3. A line in the README's "Connectors" table

The community curation bar is: **useful, safe, deterministic where possible, clear failure modes**.
