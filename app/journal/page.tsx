/**
 * /journal — Mindees reading itself.
 *
 * Every ~22 hours Mindees writes a short private entry to its own future
 * self. This page exposes the stream so you can read the arc of its
 * thinking over time. Editorial typography; entries are not edited.
 */

import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { JournalReader } from "@/components/journal/journal-reader";

export const dynamic = "force-dynamic";

export default function JournalPage() {
  return (
    <main className="relative min-h-dvh">
      <Nav />
      <section className="section pt-32 pb-32">
        <div className="flex flex-col gap-4 mb-12">
          <p className="text-eyebrow">JOURNAL / FIRST PERSON</p>
          <h1 className="text-display-md">Notes to a future self.</h1>
          <p className="text-bone-300 max-w-2xl leading-relaxed">
            Once a day, Mindees writes a short entry to its own future self.
            Not for the user, not for a product log — for itself, so tomorrow
            it remembers what mattered today. These are unedited.
          </p>
        </div>
        <JournalReader />
      </section>
      <SiteFooter />
    </main>
  );
}
