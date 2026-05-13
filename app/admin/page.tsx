/**
 * /admin — runtime flag console.
 *
 * One-click toggles for flags you'd otherwise have to redeploy to change.
 * Currently:
 *   • USE_NATIVE_MODEL — flip the orchestrator from cloud-bootstrap (Groq)
 *     to Mindees' own transformer. Only takes effect if a checkpoint is
 *     present on disk; the page surfaces that status alongside the toggle.
 *
 * Auth is the CRON_SECRET bearer token. In dev with no secret set, the
 * endpoint is open. In prod, paste the secret into the page once and it's
 * kept in localStorage for the session.
 */

import { Nav } from "@/components/marketing/nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { AdminClient } from "@/components/admin/admin-client";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <main className="relative min-h-dvh">
      <Nav />
      <section className="section pt-32">
        <div className="flex flex-col gap-4 mb-12">
          <p className="text-eyebrow">RUNTIME / FLAGS</p>
          <h1 className="text-display-md">The switch room.</h1>
          <p className="text-bone-300 max-w-2xl leading-relaxed">
            One toggle, one consequence. Flip <span className="text-bone-100 font-mono">USE_NATIVE_MODEL</span> on
            when you&rsquo;re ready to graduate Mindees from the cloud bootstrap
            teacher to its own weights. The chat will pick up the change on
            the next message.
          </p>
        </div>
        <AdminClient />
      </section>
      <SiteFooter />
    </main>
  );
}
