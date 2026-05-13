"use client";

/**
 * Small floating pill above the composer that names the current agent stage.
 * Honest UX > generic spinner.
 */

import { trust } from "@/lib/psychology/trust";

export function StageIndicator({ stage }: { stage: string }) {
  let label: string = trust.thinking;
  if (stage === "context") label = trust.retrieving;
  else if (stage === "thinking") label = trust.thinking;
  else if (stage.startsWith("tool:")) label = trust.toolPending(stage.slice(5));
  else if (stage === "synthesising") label = trust.draftingFinal;
  return (
    <span className="inline-flex items-center gap-2 glass rounded-full px-3 py-1.5 text-xs text-bone-300 shadow-lg">
      <span className="size-1.5 rounded-full bg-aurora-400 pulse-dot" />
      {label}
    </span>
  );
}
