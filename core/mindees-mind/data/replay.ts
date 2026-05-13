/**
 * Experience replay buffer.
 *
 * Bounded FIFO of (tokens, source, score) tuples. The online training loop
 * draws a mixed microbatch from here so it doesn't catastrophically forget
 * older patterns while learning from recent conversations.
 *
 * Persisted to disk so the buffer survives process restarts.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type ReplayEntry = {
  tokens: number[];                       // Int32Array.toArray() — JSON-friendly
  source: "conversation" | "reflection" | "curriculum" | "dpo-chosen" | "dpo-rejected" | "constitutional" | "distill";
  score: number;                          // higher = more useful as training signal
  createdAt: string;
};

import { dataPath } from "@/lib/paths";

const FILE = dataPath("replay-buffer.json");

export class ReplayBuffer {
  private items: ReplayEntry[] = [];
  constructor(public capacity = 5000) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(FILE, "utf8");
      const parsed = JSON.parse(raw) as ReplayEntry[];
      if (Array.isArray(parsed)) this.items = parsed.slice(-this.capacity);
    } catch { /* fresh start */ }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(this.items.slice(-this.capacity)), "utf8");
  }

  push(entry: ReplayEntry): void {
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.shift();
  }

  /** Sample n items, weighted by score. */
  sample(n: number): ReplayEntry[] {
    if (this.items.length === 0) return [];
    const total = this.items.reduce((s, e) => s + Math.max(1e-3, e.score), 0);
    const out: ReplayEntry[] = [];
    for (let i = 0; i < n; i++) {
      let r = Math.random() * total;
      for (const e of this.items) {
        r -= Math.max(1e-3, e.score);
        if (r <= 0) {
          out.push(e);
          break;
        }
      }
    }
    return out;
  }

  size(): number {
    return this.items.length;
  }
}

let singleton: ReplayBuffer | null = null;
export async function getReplayBuffer(): Promise<ReplayBuffer> {
  if (!singleton) {
    singleton = new ReplayBuffer();
    await singleton.load();
  }
  return singleton;
}
