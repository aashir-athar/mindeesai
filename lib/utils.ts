/**
 * Tiny shared utilities used across the app.
 * Keep this file minimal — anything domain-specific belongs in its own module.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { customAlphabet } from "nanoid";

/** shadcn/ui-style class name combiner with Tailwind merging. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** URL-safe ID, 12 chars, ~71 bits of entropy. Plenty for thread / message IDs. */
export const nid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  12,
);

/** Truncate a string to `max` chars, adding an ellipsis. Unicode-aware. */
export function truncate(s: string, max = 120): string {
  if (!s) return "";
  return [...s].length <= max ? s : [...s].slice(0, max - 1).join("") + "…";
}

/** Format a Date / timestamp into a humane relative string ("3m ago"). */
export function timeAgo(input: Date | number | string): string {
  const t = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return t.toLocaleDateString();
}

/** Promise-based sleep — only ever used in non-hot paths. */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Race a promise against an AbortSignal. Throws AbortError on cancel. */
export async function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) throw signal.reason ?? new Error("aborted");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Bounded concurrency map — keeps the event loop from drowning under parallel I/O. */
export async function pMap<T, R>(
  items: readonly T[],
  fn: (item: T, i: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Clamp a number into [min, max]. */
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Type-safe JSON parse that returns null instead of throwing. */
export function safeJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Deterministic ISO timestamp — easier to grep in logs than `Date.now()`. */
export const isoNow = () => new Date().toISOString();
