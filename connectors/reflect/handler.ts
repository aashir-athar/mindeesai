/**
 * reflect connector — emits a synthetic "thinking" pause that the orchestrator
 * interprets as a cue to invoke the reflector agent inline before continuing.
 *
 * The actual reflection logic lives in `agents/reflector` — this connector
 * just signals intent; the orchestrator wires it together.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { focus?: string };

const handler: ConnectorHandler<Args> = async (args) => {
  const focus = args?.focus ?? "overall accuracy and tone";
  return {
    ok: true,
    output: {
      directive: "invoke-reflector",
      focus,
    },
  };
};

export default handler;
