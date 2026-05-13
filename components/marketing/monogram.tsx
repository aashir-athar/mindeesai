/**
 * Mindees monogram — small inline logomark.
 * A geometric "M" formed from two overlapping arches, slight stroke,
 * editorial proportions. Pairs well with display serif typography.
 */
export function Monogram({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="MindeesAI"
    >
      <defs>
        <linearGradient id="mind-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#faf9f5" />
          <stop offset="100%" stopColor="#d3b074" />
        </linearGradient>
      </defs>
      <path
        d="M4 26 L4 8 L9 8 L16 19 L23 8 L28 8 L28 26"
        stroke="url(#mind-grad)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="16" cy="22" r="1.4" fill="#d3b074" />
    </svg>
  );
}
