"use client";

/**
 * The hero orb — a CSS-animated luminous gradient that suggests an active mind.
 * Pure CSS so it costs nothing on first paint and animates at 60fps everywhere.
 */

export function HeroOrb() {
  return (
    <div className="absolute top-1/2 right-[-10%] -translate-y-1/2 size-[60rem] pointer-events-none">
      <div className="absolute inset-0 rounded-full opacity-30 blur-3xl"
           style={{
             background: "conic-gradient(from 180deg, #6b7fff 0%, #b7c8ff 25%, #ffd6a5 50%, #6b7fff 100%)",
             animation: "orb-spin 22s linear infinite",
           }} />
      <div className="absolute inset-[15%] rounded-full opacity-40 blur-2xl"
           style={{
             background: "radial-gradient(circle, rgba(141,164,255,0.5), transparent 70%)",
             animation: "orb-pulse 7s var(--ease-cinematic) infinite",
           }} />
      <style>{`
        @keyframes orb-spin { to { transform: rotate(360deg); } }
        @keyframes orb-pulse {
          0%, 100% { transform: scale(0.9); opacity: 0.35; }
          50%      { transform: scale(1.05); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
