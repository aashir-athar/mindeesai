/**
 * /research — autonomous research log.
 *
 * Every 5-minute cron picks 2-4 topics MindeesAI was uncertain about
 * and researches them via the rotation chain. This page is the trail.
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
          Every five minutes, the cron tick picks topics MindeesAI was uncertain about — a correction it received, a question it hedged on, something you signalled you didn&rsquo;t know — and researches them on its own. The findings persist as recallable memories.
        </>
      }
    >
      <ResearchLog />
    </PageShell>
  );
}
