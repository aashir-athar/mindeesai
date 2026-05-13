/**
 * /chat/[threadId] — the horizontal-scroll thinking-canvas chat UI.
 *
 * Server component shell. Hydrates with the canvas client component which
 * owns the streaming + state machine.
 *
 * `params` is async since Next 15 — must be awaited before access.
 */

import { ChatCanvas } from "@/components/chat/chat-canvas";

export const dynamic = "force-dynamic";

type Params = Promise<{ threadId: string }>;

export default async function ChatThreadPage({ params }: { params: Params }) {
  const { threadId } = await params;
  return <ChatCanvas threadId={threadId} />;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { threadId } = await params;
  return { title: `Chat · ${threadId.slice(0, 8)}` };
}
