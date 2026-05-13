/**
 * /research — what Mindees has been autonomously studying.
 *
 * Every 5-minute cron tick picks 3 topics Mindees was uncertain about and
 * researches them in the background. This page is the log: which topic,
 * which signal triggered it, how much Mindees learned. It's the visible
 * proof of "self-machine-learning about anything in the world".
 */

import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ResearchLog } from "@/components/research/research-log";

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  return (
    <main className="relative min-h-dvh">
      <Nav />
      <section className="section pt-32 pb-32">
        <div className="flex flex-col gap-4 mb-12">
          <p className="text-eyebrow">RESEARCH / AUTONOMOUS</p>
          <h1 className="text-display-md">What it&rsquo;s been studying.</h1>
          <p className="text-bone-300 max-w-2xl leading-relaxed">
            Every five minutes, the cron tick picks the topics Mindees was most
            uncertain about — a correction it received, a question it hedged on,
            something the user signalled they didn&rsquo;t know — and goes
            researching them on its own. The findings land as recallable memories.
            Next conversation about that topic, Mindees has substance.
          </p>
        </div>
        <ResearchLog />
      </section>
      <SiteFooter />
    </main>
  );
}
