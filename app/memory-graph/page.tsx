/**
 * /memory-graph — knowledge graph triples MindeesAI learned about you.
 */

import { PageShell } from "@/components/marketing/page-shell";
import { GraphReader } from "@/components/memory-graph/graph-reader";

export const dynamic = "force-dynamic";

export default function MemoryGraphPage() {
  return (
    <PageShell
      kicker="04 — Knowledge graph"
      title="What it knows."
      lede={
        <>
          Every fact MindeesAI has extracted from your conversations, rendered as subject &rarr; predicate &rarr; object. The store grows as you talk. Search by entity to see one node&rsquo;s full neighbourhood.
        </>
      }
    >
      <GraphReader />
    </PageShell>
  );
}
