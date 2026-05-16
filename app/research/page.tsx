/**
 * /research — autonomous research log.
 *
 * Each cron tick picks 1-2 topics MindeesAI was uncertain about and
 * researches them via the rotation chain. This page is the trail.
 */

import { PageShell } from "@/components/marketing/page-shell";
import { ResearchLog } from "@/components/research/research-log";

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  return (
    <PageShell
      kicker="03 — Autonomous research"
      title="What it's been studying."
      lede={
        <>
          Every cron tick (~15 minutes), MindeesAI picks topics it was uncertain about — a correction it received, a question it hedged on, something you signalled you didn&rsquo;t know — and researches them on its own. The findings persist as recallable memories.
        </>
      }
    >
      <ResearchLog />
    </PageShell>
  );
}
