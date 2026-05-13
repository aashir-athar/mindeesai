/**
 * PullQuote — editorial pull quote with attribution.
 * Tight typography, Fraunces in italic-ish wonk axis, off-warm accent.
 */
import { ReactNode } from "react";

export function PullQuote({
  children,
  attribution,
  align = "left",
}: {
  children: ReactNode;
  attribution?: string;
  align?: "left" | "center";
}) {
  return (
    <figure className={`flex flex-col gap-6 ${align === "center" ? "items-center text-center" : ""}`}>
      <span aria-hidden className="text-warm-400 text-display-md leading-none select-none">"</span>
      <blockquote className="text-display-sm text-bone-50 max-w-3xl">
        <span className="text-display" style={{ fontSize: "inherit", fontVariationSettings: '"SOFT" 70, "WONK" 1' }}>
          {children}
        </span>
      </blockquote>
      {attribution && (
        <figcaption className="text-eyebrow">{attribution}</figcaption>
      )}
    </figure>
  );
}
