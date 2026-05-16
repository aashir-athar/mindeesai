/**
 * Single source of truth for threadId shape and validation.
 *
 * Background: every endpoint that takes a threadId used a slightly different
 * regex (some did `min(1).max(64)` without a regex, some used a strict regex
 * with bounds, /api/persona did no validation at all and silently defaulted
 * to "default" which leaked aggregate state across users). That drift was
 * a real privacy + path-traversal concern.
 *
 * Use the helpers here in EVERY endpoint that accepts a threadId.
 */

import { z } from "zod";

/**
 * Allowed character set: alphanumeric + dash + underscore.
 * Length: 1-64 chars.
 * Why this shape:
 *   - alphanumeric + `-_` matches `nid()` output (nanoid alphabet) AND lets
 *     us safely build file paths from it without escaping
 *   - 1-64 cap fits the standard nanoid (21 chars) plus headroom for any
 *     future longer scheme without enabling arbitrarily-long IDs
 *   - excludes `.` and `/` — those would enable path-traversal on filesystems
 */
export const THREAD_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/** Zod schema — use in request body parsers. */
export const ThreadIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(THREAD_ID_REGEX, "threadId must be 1-64 chars of [a-zA-Z0-9_-]");

/**
 * Predicate — use for URL params or other places where we want a boolean.
 * Returns true iff `id` is a syntactically valid threadId.
 */
export function isValidThreadId(id: unknown): id is string {
  return typeof id === "string" && THREAD_ID_REGEX.test(id);
}

/**
 * Strict accessor — throws if invalid. Use when the threadId is required
 * and a downstream operation can't tolerate a bad value.
 */
export function assertThreadId(id: unknown): string {
  if (!isValidThreadId(id)) {
    throw new Error(`invalid threadId: ${typeof id === "string" ? JSON.stringify(id.slice(0, 80)) : typeof id}`);
  }
  return id;
}
