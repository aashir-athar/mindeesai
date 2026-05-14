/**
 * /dashboard — live persona state dashboard.
 *
 * Audit page for every persistent tensor. Reads directly from
 * /api/persona on a 15s poll.
 */

import { PageShell } from "@/components/marketing/page-shell";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <PageShell
      kicker="01 — Live state"
      title="MindeesAI, audited."
      lede={
        <>
          Every tensor. Every weight. Every cron tick. This page reads directly from the persistence layer — if you see numbers move, the system is learning. If they don&rsquo;t, ask why.
        </>
      }
    >
      <DashboardClient />
    </PageShell>
  );
}
