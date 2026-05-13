/**
 * /chat — entry route. Generates a thread ID and redirects to /chat/[threadId].
 * Implemented as a server component so the redirect happens before paint.
 */

import { redirect } from "next/navigation";
import { nid } from "@/lib/utils";

export default function ChatEntry() {
  const id = nid();
  redirect(`/chat/${id}`);
}
