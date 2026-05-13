/**
 * /setup — at-a-glance deployment health.
 *
 * Answers "is this set up correctly?" in one screen. Reads /api/health
 * (no auth — same as the rest of the audit pages) and renders each
 * subsystem with a colour-coded status row + concrete next-action when
 * something's off.
 */

import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SetupChecklist } from "@/components/setup/setup-checklist";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  return (
    <main className="relative min-h-dvh">
      <Nav />
      <section className="section pt-32 pb-32">
        <div className="flex flex-col gap-4 mb-12">
          <p className="text-eyebrow">DEPLOYMENT / STATUS</p>
          <h1 className="text-display-md">Is this working?</h1>
          <p className="text-bone-300 max-w-2xl leading-relaxed">
            One page, ground truth on every subsystem. Green is healthy. Amber
            means something optional is missing. Red means a hard
            dependency is broken — fix it and the whole self-learning
            loop comes online.
          </p>
        </div>
        <SetupChecklist />
      </section>
      <SiteFooter />
    </main>
  );
}
