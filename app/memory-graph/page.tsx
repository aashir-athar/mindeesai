/**
 * /memory-graph — Mindees' learned facts about the world, audited.
 *
 * Renders the full triple store (subject → predicate → object) extracted
 * from past conversations. Useful for asking "why does Mindees think I
 * prefer X" and getting a concrete answer.
 */

import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { GraphReader } from "@/components/memory-graph/graph-reader";

export const dynamic = "force-dynamic";

export default function MemoryGraphPage() {
  return (
    <main className="relative min-h-dvh">
      <Nav />
      <section className="section pt-32 pb-32">
        <div className="flex flex-col gap-4 mb-12">
          <p className="text-eyebrow">KNOWLEDGE / TRIPLES</p>
          <h1 className="text-display-md">What it knows.</h1>
          <p className="text-bone-300 max-w-2xl leading-relaxed">
            Every fact Mindees has extracted from your conversations, rendered as
            subject → predicate → object. The store grows as you talk. Search
            by entity to see one node&rsquo;s full neighbourhood.
          </p>
        </div>
        <GraphReader />
      </section>
      <SiteFooter />
    </main>
  );
}
