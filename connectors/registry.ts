/**
 * Static built-in connector registry.
 *
 * Turbopack (and any modern bundler) cannot statically analyse the dynamic
 * `import(variable)` pattern. So we list every built-in connector here and
 * the loader consumes this registry instead of scanning the filesystem.
 *
 * To add a new built-in connector:
 *   1. Drop the folder under `connectors/<name>/`.
 *   2. Add four lines to this file (handler import + manifest import + entry).
 *   3. Restart `pnpm dev`.
 *
 * Yes, this is one extra line of bookkeeping vs. pure folder-scan auto-discovery.
 * The bookkeeping is the price of correct bundling — and the trade-off is worth
 * it because the static graph means the connector code is *guaranteed* to be
 * included in the production bundle.
 *
 * User-installed third-party connectors should publish themselves as npm
 * packages exporting `{ manifest, handler }` and import them here.
 */

import type { ConnectorHandler, ConnectorManifest } from "@/lib/types";

import calculatorHandler from "./calculator/handler";
import calculatorManifest from "./calculator/manifest.json";

import codeExecHandler from "./code-exec/handler";
import codeExecManifest from "./code-exec/manifest.json";

import fileReadHandler from "./file-read/handler";
import fileReadManifest from "./file-read/manifest.json";

import reflectHandler from "./reflect/handler";
import reflectManifest from "./reflect/manifest.json";

import webCrawlHandler from "./web-crawl/handler";
import webCrawlManifest from "./web-crawl/manifest.json";

import webSearchHandler from "./web-search/handler";
import webSearchManifest from "./web-search/manifest.json";

export interface RegisteredConnectorEntry {
  manifest: ConnectorManifest;
  handler: ConnectorHandler;
  /** Directory name under `connectors/` — used for loading `prompt.md`. */
  dir: string;
}

export const BUILT_IN_CONNECTORS: RegisteredConnectorEntry[] = [
  { manifest: calculatorManifest as ConnectorManifest, handler: calculatorHandler as ConnectorHandler, dir: "calculator" },
  { manifest: codeExecManifest as ConnectorManifest,   handler: codeExecHandler as ConnectorHandler,   dir: "code-exec" },
  { manifest: fileReadManifest as ConnectorManifest,   handler: fileReadHandler as ConnectorHandler,   dir: "file-read" },
  { manifest: reflectManifest as ConnectorManifest,    handler: reflectHandler as ConnectorHandler,    dir: "reflect" },
  { manifest: webCrawlManifest as ConnectorManifest,   handler: webCrawlHandler as ConnectorHandler,   dir: "web-crawl" },
  { manifest: webSearchManifest as ConnectorManifest,  handler: webSearchHandler as ConnectorHandler,  dir: "web-search" },
];
