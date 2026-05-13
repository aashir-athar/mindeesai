/**
 * Re-export of connector types for the public connector author surface.
 * Connector authors import from `@/lib/connectors/types`.
 */

export type {
  ConnectorContext,
  ConnectorHandler,
  ConnectorManifest,
  ConnectorResult,
  Citation,
} from "@/lib/types";
export { ConnectorManifestSchema } from "@/lib/types";
