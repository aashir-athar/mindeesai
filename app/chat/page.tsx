/**
 * /chat — entry route. Generates a thread ID and redirects to /chat/[threadId].
 * Implemented as a server component so the redirect happens before paint.
 *
 * `force-dynamic` is critical: without it, Next.js caches the server-rendered
 * redirect at build time, so every visitor to /chat is sent to the SAME
 * thread ID — the one nid() returned during the build. That's why opening
 * /chat on laptop and PC was landing on the same thread.
 */

import { redirect } from "next/navigation";
import { nid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function ChatEntry() {
  const id = nid();
  redirect(`/chat/${id}`);
}
