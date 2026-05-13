/**
 * Auto-title generator — produces a short editorial-style title for a thread
 * from its first exchange. Free via the configured cloud LLM (Groq).
 *
 * Output discipline:
 *   - 3 to 6 words
 *   - No quotes, no trailing punctuation
 *   - Title-case-ish (preserve acronyms)
 *   - "Self-learning architecture", not "About the self-learning architecture..."
 */

import { streamLLM } from "@/lib/llm/router";
import { isoNow, nid } from "@/lib/utils";

export async function generateThreadTitle(opts: {
  firstUserMessage: string;
  firstAssistantReply: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const userExcerpt = opts.firstUserMessage.slice(0, 320);
  const assistantExcerpt = opts.firstAssistantReply.slice(0, 320);

  const system = `\
You write titles for a conversation log. The user just chatted with Mindees. Title the exchange so the user can find it again later.

Rules:
- 3 to 6 words, no more.
- No quotes, no period, no trailing punctuation.
- Concrete and specific. Prefer noun-phrases.
- If the user asked a question, title it from the topic — not the question form.
- No "Discussion about", "Conversation on", "Question about". Just the topic.
- Output ONLY the title. Nothing else.

Examples:
  USER:  "How do I implement a transformer from scratch in TypeScript?"
  TITLE: TypeScript transformer from scratch

  USER:  "Hey can you remember what I said yesterday about my cat?"
  TITLE: Cat from yesterday

  USER:  "I'm stuck on this bug in the cron tick"
  TITLE: Cron tick bug
`;

  try {
    let buf = "";
    for await (const chunk of streamLLM({
      messages: [
        {
          id: nid(),
          role: "user",
          content: `USER:\n${userExcerpt}\n\nASSISTANT:\n${assistantExcerpt}\n\nTITLE:`,
          createdAt: isoNow(),
        },
      ],
      system,
      temperature: 0.4,
      maxTokens: 20,
      signal: opts.signal,
    })) {
      if (chunk.type === "text" && chunk.text) buf += chunk.text;
      if (chunk.type === "finish") break;
    }
    const cleaned = (buf
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/[.!?]+$/g, "")
      .replace(/\s+/g, " ")
      .split("\n")[0] ?? "")
      .trim();
    if (!cleaned || cleaned.length > 80) return null;
    return cleaned;
  } catch {
    return null;
  }
}
