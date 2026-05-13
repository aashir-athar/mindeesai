/**
 * Knowledge-graph triple extraction.
 *
 * After each chat turn, a small LLM call distils the exchange into a few
 * (subject, predicate, object) triples and appends them to the in-repo
 * graph at data/graph.json. Mindees builds an entity-relationship model
 * of the user's world automatically.
 *
 *   "I work at Cloudflare on Workers AI"
 *     → (you, works_at, Cloudflare)
 *     → (you, focus, Workers AI)
 *
 * On retrieval, the orchestrator can call `neighbours("Cloudflare")` to
 * surface every related fact across all conversations.
 *
 * Free: one Groq call per turn, ~200ms. Output is strict JSON; bad
 * outputs are silently dropped (no extracted triples > continued service).
 */

import { streamLLM } from "@/lib/llm/router";
import { isoNow, nid, safeJson } from "@/lib/utils";
import { addTriples, type Triple } from "@/lib/memory/graph";
import { createLogger } from "@/lib/logger";

const log = createLogger("extract-triples");

const EXTRACT_PROMPT = `\
You read one exchange between a user and an assistant. Extract any durable, factual triples about the user, the user's world, or topics they care about. Output STRICT JSON only — no prose, no markdown.

Triple format:
  { "subject": "...", "predicate": "...", "object": "..." }

Rules:
- Triples must describe USER-side facts, NOT what the assistant said in reply.
- The subject is usually "you" (the user). Use other subjects when needed.
- Predicates are snake_case verbs or relationships: works_at, lives_in, prefers, dislikes, building, debugging, mentioned, asked_about.
- Skip filler / chitchat — only emit triples worth remembering long-term.
- If nothing durable was said, emit { "triples": [] }.
- Output: { "triples": [ ... ] }. Max 4 triples per turn.

Examples:

  USER: "I'm Aashir, I'm in Karachi building MindeesAI"
  → {"triples":[{"subject":"you","predicate":"name","object":"Aashir"},{"subject":"you","predicate":"lives_in","object":"Karachi"},{"subject":"you","predicate":"building","object":"MindeesAI"}]}

  USER: "haha that's funny"
  → {"triples":[]}

  USER: "I really hate React Server Components."
  → {"triples":[{"subject":"you","predicate":"dislikes","object":"React Server Components"}]}
`;

export async function extractAndPersistTriples(opts: {
  userMessage: string;
  assistantReply: string;
  signal?: AbortSignal;
}): Promise<{ added: number }> {
  let buf = "";
  try {
    for await (const chunk of streamLLM({
      messages: [
        {
          id: nid(),
          role: "user",
          content: `USER:\n${opts.userMessage.slice(0, 500)}\n\nASSISTANT:\n${opts.assistantReply.slice(0, 300)}\n\nOutput JSON:`,
          createdAt: isoNow(),
        },
      ],
      system: EXTRACT_PROMPT,
      temperature: 0.1,
      maxTokens: 200,
      signal: opts.signal,
    })) {
      if (chunk.type === "text" && chunk.text) buf += chunk.text;
      if (chunk.type === "finish") break;
    }
  } catch (e) {
    log.warn("extraction LLM call failed", e);
    return { added: 0 };
  }

  const json = buf
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  const parsed = safeJson<{ triples?: Array<{ subject: string; predicate: string; object: string }> }>(json);
  if (!parsed?.triples || !Array.isArray(parsed.triples) || parsed.triples.length === 0) {
    return { added: 0 };
  }

  const triples: Triple[] = parsed.triples
    .filter((t) => t && typeof t.subject === "string" && typeof t.predicate === "string" && typeof t.object === "string")
    .filter((t) => t.subject.length < 80 && t.predicate.length < 60 && t.object.length < 200)
    .slice(0, 4)
    .map((t) => ({
      subject: t.subject.trim(),
      predicate: t.predicate.trim().toLowerCase().replace(/\s+/g, "_"),
      object: t.object.trim(),
      source: "extract-triples",
      createdAt: new Date().toISOString(),
    }));

  if (triples.length === 0) return { added: 0 };

  await addTriples(triples);
  return { added: triples.length };
}
