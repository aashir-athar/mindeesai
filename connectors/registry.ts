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

// v0.3 — Mindees skill pack (all free-tier, no API keys required)
import wikipediaHandler from "./wikipedia/handler";
import wikipediaManifest from "./wikipedia/manifest.json";

import weatherHandler from "./weather/handler";
import weatherManifest from "./weather/manifest.json";

import datetimeHandler from "./datetime/handler";
import datetimeManifest from "./datetime/manifest.json";

import githubSearchHandler from "./github-search/handler";
import githubSearchManifest from "./github-search/manifest.json";

import stackoverflowHandler from "./stackoverflow/handler";
import stackoverflowManifest from "./stackoverflow/manifest.json";

import dictionaryHandler from "./dictionary/handler";
import dictionaryManifest from "./dictionary/manifest.json";

import hackernewsHandler from "./hackernews/handler";
import hackernewsManifest from "./hackernews/manifest.json";

import arxivHandler from "./arxiv/handler";
import arxivManifest from "./arxiv/manifest.json";

export interface RegisteredConnectorEntry {
  manifest: ConnectorManifest;
  handler: ConnectorHandler;
  /** Directory name under `connectors/` — used for loading `prompt.md`. */
  dir: string;
}

export const BUILT_IN_CONNECTORS: RegisteredConnectorEntry[] = [
  { manifest: calculatorManifest as ConnectorManifest,    handler: calculatorHandler as ConnectorHandler,    dir: "calculator" },
  { manifest: codeExecManifest as ConnectorManifest,      handler: codeExecHandler as ConnectorHandler,      dir: "code-exec" },
  { manifest: fileReadManifest as ConnectorManifest,      handler: fileReadHandler as ConnectorHandler,      dir: "file-read" },
  { manifest: reflectManifest as ConnectorManifest,       handler: reflectHandler as ConnectorHandler,       dir: "reflect" },
  { manifest: webCrawlManifest as ConnectorManifest,      handler: webCrawlHandler as ConnectorHandler,      dir: "web-crawl" },
  { manifest: webSearchManifest as ConnectorManifest,     handler: webSearchHandler as ConnectorHandler,     dir: "web-search" },
  // v0.3 skill pack — all free, all key-less, no paid services
  { manifest: wikipediaManifest as ConnectorManifest,     handler: wikipediaHandler as ConnectorHandler,     dir: "wikipedia" },
  { manifest: weatherManifest as ConnectorManifest,       handler: weatherHandler as ConnectorHandler,       dir: "weather" },
  { manifest: datetimeManifest as ConnectorManifest,      handler: datetimeHandler as ConnectorHandler,      dir: "datetime" },
  { manifest: githubSearchManifest as ConnectorManifest,  handler: githubSearchHandler as ConnectorHandler,  dir: "github-search" },
  { manifest: stackoverflowManifest as ConnectorManifest, handler: stackoverflowHandler as ConnectorHandler, dir: "stackoverflow" },
  { manifest: dictionaryManifest as ConnectorManifest,    handler: dictionaryHandler as ConnectorHandler,    dir: "dictionary" },
  { manifest: hackernewsManifest as ConnectorManifest,    handler: hackernewsHandler as ConnectorHandler,    dir: "hackernews" },
  { manifest: arxivManifest as ConnectorManifest,         handler: arxivHandler as ConnectorHandler,         dir: "arxiv" },
];
