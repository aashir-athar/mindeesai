/**
 * MindeesAI logomark.
 *
 * Renders the 3D brain logo at any size via next/image. The chroma-green
 * background was keyed out of the PNG at /public/assets/mind-logo.png
 * so it composites cleanly over any backdrop.
 */

import Image from "next/image";

export function Monogram({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/assets/mind-logo.png"
      alt="MindeesAI"
      width={size}
      height={size}
      priority
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
