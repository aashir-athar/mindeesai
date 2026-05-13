/**
 * /dashboard — live persona state dashboard.
 *
 * Editorial render of the persistent tensors:
 *   • Mood (8-dim, global)
 *   • Latest user model + relationship (per-thread, manual lookup)
 *   • Drift fingerprint trail
 *   • Reward predictor
 *   • Cron / training metrics
 *
 * Visible proof that the self-learning architecture is actually
 * accumulating state — not a marketing claim, an audit page.
 */

import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <main className="relative min-h-dvh">
      <Nav />
      <section className="section pt-32">
        <div className="flex flex-col gap-4 mb-12">
          <p className="text-eyebrow">DOSSIER / LIVE STATE</p>
          <h1 className="text-display-md">Mindees, audited.</h1>
          <p className="text-bone-300 max-w-2xl leading-relaxed">
            Every tensor. Every weight. Every cron tick. This page reads directly
            from the persistence layer — if you see numbers move, the system is
            learning. If they don&rsquo;t, ask why.
          </p>
        </div>
        <DashboardClient />
      </section>
      <SiteFooter />
    </main>
  );
}
