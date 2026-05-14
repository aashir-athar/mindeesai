/**
 * /admin — runtime flag console and operator actions.
 */

import { PageShell } from "@/components/marketing/page-shell";
import { AdminClient } from "@/components/admin/admin-client";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <PageShell
      kicker="05 — Admin"
      title="The switch room."
      lede={
        <>
          One toggle, one consequence. Flip <span className="font-mono text-bone-100">USE_NATIVE_MODEL</span> on when you&rsquo;re ready to graduate from the cloud bootstrap teacher to your own weights. The chat picks up the change on the next message.
        </>
      }
    >
      <AdminClient />
    </PageShell>
  );
}
