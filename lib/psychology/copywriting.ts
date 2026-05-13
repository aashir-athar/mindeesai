/**
 * 2026 conversion-copy helpers.
 *
 * These are NOT manipulative. They are the well-studied levers (loss aversion,
 * social proof, authority, reciprocity, scarcity, specificity) applied with
 * honesty: every fact stated must be true, every claim verifiable.
 *
 * The pattern: every public marketing string is generated through one of
 * these helpers so we have a single audit point for our promotional copy.
 */

export const headlines = {
  hero: "An AI that gets smarter every five minutes — and remembers you forever.",
  heroSub:
    "MindeesAI is open-source, self-improving, and runs on your laptop. No subscription. No surveillance. No forgetting.",
  trustBar: "Free. Open-source. MIT-licensed. Self-hostable. Yours.",
} as const;

export const lossAversion = {
  forgetting:
    "Most AIs forget you the moment your tab closes. MindeesAI remembers — and gets a little smarter every five minutes you keep using it.",
  vendorLock:
    "Closed AIs own your context. The day they raise prices, you have no choice. MindeesAI runs on your laptop, your server, your terms.",
} as const;

export const socialProof = {
  contributors: "Built in the open by a growing community of contributors.",
  stars: (count: number) =>
    count > 0
      ? `${formatCount(count)} developers have starred this on GitHub.`
      : "Be the first to star this on GitHub.",
} as const;

export const authority = {
  citationsAreFirstClass:
    "Every factual answer carries citations. Hover any [1] to see the source. No citation? Then it's our inference — and we say so.",
  reflectionLog:
    "The 5-minute self-improvement loop writes an append-only log. You can audit every change MindeesAI has made to its own brain.",
} as const;

export const reciprocity = {
  freeTier:
    "There is no paid tier. The free version is the full version. We make money the day MindeesAI is so good companies pay us to deploy it inside their walls.",
} as const;

export const specificity = {
  ttfb: "Streaming starts in under 200ms on a warm Ollama instance.",
  retrieval: "Recall is augmented by a LanceDB vector store with sub-50ms top-K retrieval.",
  cadence: "Self-improvement runs every 5 minutes — that's 288 brain updates per day.",
} as const;

function formatCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(n / 1000) + "k";
}
