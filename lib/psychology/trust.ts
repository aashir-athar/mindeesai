/**
 * Trust micro-copy — short strings the chat UI shows during agent state changes.
 *
 * Goal: every loading state communicates *what* the agent is doing and *why*,
 * not a generic spinner. Transparency is the cheapest trust-builder in chat UX.
 */

export const trust = {
  thinking: "Thinking…",
  retrieving: "Searching what I already know…",
  researching: (n: number) => `Reading ${n} source${n === 1 ? "" : "s"}…`,
  reflecting: "Reflecting on this conversation…",
  reranking: "Sorting the evidence by relevance…",
  toolPending: (name: string) => `Calling the \`${name}\` skill…`,
  toolDone: (name: string, ms: number) => `\`${name}\` finished in ${ms}ms`,
  draftingFinal: "Composing answer…",
  cite: (n: number) => `${n} citation${n === 1 ? "" : "s"} attached`,

  // honest failure copy
  noProvider:
    "No LLM provider is reachable. I checked Ollama and every cloud key you've configured. Start Ollama or add a key to .env.local and reload.",
  toolFailed: (name: string) =>
    `The \`${name}\` skill failed. I'll continue with what I have, but my answer is now less grounded than I'd like.`,
  rateLimited: "We're being rate-limited upstream. Retrying in a moment…",
} as const;
