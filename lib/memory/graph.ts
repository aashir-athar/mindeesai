/**
 * Lightweight graph memory.
 *
 * Stores entity → relationship → entity triples in a single JSON file. Not a
 * full graph DB — but enough to power "what do I know about X?" retrieval.
 *
 * On every conversation turn the orchestrator may call `addTriples()` with
 * extracted entities. On retrieval, `neighbours()` returns 1-hop facts about
 * any matching entity name (case-insensitive).
 *
 * When the graph exceeds ~50k triples, swap this for a real backend (KuzuDB,
 * Neo4j embedded). The contract here is intentionally narrow so that swap is
 * a single-file change.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("graph.json");

export type Triple = {
  subject: string;
  predicate: string;
  object: string;
  source?: string;
  createdAt: string;
};

type GraphFile = { triples: Triple[] };

let cache: GraphFile | null = null;

async function load(): Promise<GraphFile> {
  if (cache) return cache;
  try {
    const raw = await readFile(FILE, "utf8");
    cache = JSON.parse(raw) as GraphFile;
  } catch {
    cache = { triples: [] };
  }
  return cache;
}

async function save(g: GraphFile): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(g, null, 2), "utf8");
  cache = g;
}

export async function addTriples(triples: Triple[]): Promise<void> {
  if (triples.length === 0) return;
  const g = await load();
  for (const t of triples) {
    // Naive dedupe — same subject+predicate+object collapses
    const exists = g.triples.some(
      (x) => x.subject === t.subject && x.predicate === t.predicate && x.object === t.object,
    );
    if (!exists) g.triples.push(t);
  }
  await save(g);
}

export async function neighbours(entity: string, depth = 1): Promise<Triple[]> {
  const g = await load();
  const lower = entity.toLowerCase();
  const seeds = g.triples.filter(
    (t) => t.subject.toLowerCase() === lower || t.object.toLowerCase() === lower,
  );
  if (depth <= 1) return seeds;
  const next = new Set<string>();
  for (const t of seeds) {
    next.add(t.subject);
    next.add(t.object);
  }
  next.delete(entity);
  const more = g.triples.filter((t) => next.has(t.subject) || next.has(t.object));
  return [...new Set([...seeds, ...more])];
}

export async function allTriples(): Promise<Triple[]> {
  return (await load()).triples;
}
