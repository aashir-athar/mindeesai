/**
 * SectionHeading — editorial chapter heading.
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  01  /  CHAPTER NAME                           │
 *   │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
 *   │  Display headline that can be                  │
 *   │  multi-line and uses editorial type.           │
 *   │                                                │
 *   │  Optional lede paragraph in muted body.        │
 *   └────────────────────────────────────────────────┘
 */
import { ReactNode } from "react";

export function SectionHeading({
  index,
  kicker,
  title,
  lede,
  align = "left",
}: {
  index: string;
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <header className={`flex flex-col gap-6 ${align === "center" ? "items-center text-center" : ""}`}>
      <div className="flex items-center gap-3 text-eyebrow">
        <span className="text-tabular text-bone-300">{index}</span>
        <span className="rule-fade w-10" aria-hidden />
        <span>{kicker}</span>
      </div>
      <h2 className="text-display-md max-w-4xl">{title}</h2>
      {lede && (
        <p className="text-lg leading-relaxed text-bone-300 max-w-2xl">{lede}</p>
      )}
    </header>
  );
}
