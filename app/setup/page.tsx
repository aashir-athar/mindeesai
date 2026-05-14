/**
 * /setup — one-screen deployment health board.
 */

import { PageShell } from "@/components/marketing/page-shell";
import { SetupChecklist } from "@/components/setup/setup-checklist";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  return (
    <PageShell
      kicker="00 — Setup"
      title="Is this working?"
      lede={
        <>
          One page, ground truth on every subsystem. Green is healthy. Amber means something optional is missing. Red means a hard dependency is broken — fix it and the whole self-learning loop comes online.
        </>
      }
    >
      <SetupChecklist />
    </PageShell>
  );
}
