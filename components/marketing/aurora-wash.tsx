/**
 * AuroraWash — calm decorative background.
 *
 * Replaces the busy spinning orb with a refined, slow-moving aurora gradient
 * positioned off-frame. CSS only — no JS, no canvas, no perf cost.
 *
 * Used as a fixed background layer behind the hero.
 */
export function AuroraWash() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Top right wash */}
      <div
        aria-hidden
        className="absolute -top-40 -right-40 h-[42rem] w-[42rem] rounded-full opacity-[0.18] blur-3xl"
        style={{ background: "radial-gradient(closest-side, #8aa0ff 0%, transparent 70%)" }}
      />
      {/* Warm anchor — bottom left */}
      <div
        aria-hidden
        className="absolute top-1/2 -left-40 h-[36rem] w-[36rem] rounded-full opacity-[0.10] blur-3xl"
        style={{ background: "radial-gradient(closest-side, #d3b074 0%, transparent 70%)" }}
      />
    </div>
  );
}
