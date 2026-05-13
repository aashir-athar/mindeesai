/**
 * /chat/[threadId] — the horizontal-scroll thinking-canvas chat UI.
 *
 * Server component shell. Hydrates with the canvas client component which
 * owns the streaming + state machine.
 */

import { ChatCanvas } from "@/components/chat/chat-canvas";

export const dynamic = "force-dynamic";

export default function ChatThreadPage({ params }: { params: { threadId: string } }) {
  return <ChatCanvas threadId={params.threadId} />;
}

export function generateMetadata({ params }: { params: { threadId: string } }) {
  return { title: `Chat · ${params.threadId.slice(0, 8)}` };
}
