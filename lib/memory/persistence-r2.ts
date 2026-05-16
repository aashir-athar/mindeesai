/**
 * Cloudflare R2 persistence adapter.
 *
 * S3-compatible storage with the killer feature for our use case:
 *   - 10 GB storage free
 *   - 1,000,000 Class A (writes) ops/month free
 *   - 10,000,000 Class B (reads) ops/month free
 *   - $0 egress charges, forever
 *
 * That last point is why R2 wins over Vercel Blob for hydration-heavy
 * workloads: every cold start on Vercel pulls the entire snapshot to
 * /tmp, and Blob's egress would price that out at scale. R2 doesn't.
 *
 * No SDK dependency — this file implements AWS SigV4 directly against
 * Node's built-in `node:crypto`. Adds ~150 lines of focused code and
 * 0 KB to the bundle. The S3 surface we need is small: PUT/GET/DELETE/LIST.
 */

import { createHash, createHmac } from "node:crypto";
import { env } from "@/lib/env";

const SERVICE = "s3";
const REGION = "auto"; // R2 uses "auto" as the literal region string

export interface R2Client {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function r2ClientFromEnv(): R2Client | null {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

// ─── public API ──────────────────────────────────────────────────────────

/** Upload an object. `body` can be a Buffer or Uint8Array. */
export async function r2Put(client: R2Client, key: string, body: Buffer | Uint8Array, contentType = "application/octet-stream"): Promise<void> {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const res = await signedFetch(client, "PUT", key, buf, { "content-type": contentType });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
  }
}

/** Download an object as a Buffer. Returns null on 404. */
export async function r2Get(client: R2Client, key: string): Promise<Buffer | null> {
  const res = await signedFetch(client, "GET", key);
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`R2 GET ${key} failed: ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/** Delete an object. Idempotent — succeeds on 404. */
export async function r2Delete(client: R2Client, key: string): Promise<void> {
  const res = await signedFetch(client, "DELETE", key);
  if (res.status === 404 || res.ok) return;
  const detail = await res.text().catch(() => "");
  throw new Error(`R2 DELETE ${key} failed: ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
}

/**
 * Delete every object under `prefix`. Returns the count deleted.
 *
 * Used for thread-scoped right-to-be-forgotten: deleting a thread locally
 * is fine for the current process, but the remote bucket would still hold
 * `data/conversations/<id>.jsonl`, `data/user-models/<id>.json`, etc.
 * Forever. This function walks the prefix via LIST and deletes each match.
 *
 * Idempotent. Quietly succeeds when nothing matches the prefix.
 */
export async function r2DeletePrefix(client: R2Client, prefix: string): Promise<number> {
  const objects = await r2List(client, prefix);
  if (objects.length === 0) return 0;
  let deleted = 0;
  for (const obj of objects) {
    try {
      await r2Delete(client, obj.key);
      deleted++;
    } catch {
      // best-effort — a partial wipe is still better than no wipe
    }
  }
  return deleted;
}

export interface R2Object {
  key: string;
  size: number;
  etag?: string;
}

/** List objects under a prefix. Auto-paginates. */
export async function r2List(client: R2Client, prefix: string): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let continuationToken: string | undefined;
  // ListObjectsV2 default cap is 1000 keys per call. We loop until truncated=false.
  for (let i = 0; i < 100; i++) {
    const qs = new URLSearchParams({ "list-type": "2", prefix });
    if (continuationToken) qs.set("continuation-token", continuationToken);
    const path = `?${qs.toString()}`;
    const res = await signedFetch(client, "GET", path, undefined, undefined, /* isQuery */ true);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`R2 LIST ${prefix} failed: ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
    }
    const xml = await res.text();
    parseListXml(xml, out);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    if (!truncated) break;
    const m = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (!m || !m[1]) break;
    continuationToken = m[1];
  }
  return out;
}

function parseListXml(xml: string, out: R2Object[]): void {
  // Minimal parser for <Contents>...</Contents> blocks. R2's XML is
  // identical to S3's, so this stays compatible. We only need Key + Size.
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    if (!block) continue;
    const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1];
    const size = parseInt(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? "0", 10);
    const etag = block.match(/<ETag>"?([^"<]+)"?<\/ETag>/)?.[1];
    if (key) out.push({ key, size, etag });
  }
}

// ─── SigV4 internals ─────────────────────────────────────────────────────

async function signedFetch(
  client: R2Client,
  method: "GET" | "PUT" | "DELETE",
  keyOrQuery: string,
  body?: Buffer,
  extraHeaders?: Record<string, string>,
  isQuery = false,
): Promise<Response> {
  // Build the path. If `keyOrQuery` starts with "?" it's a bucket-level
  // query (e.g. list-objects); otherwise it's an object key.
  const urlPath = isQuery
    ? `/${client.bucket}${keyOrQuery}`
    : `/${client.bucket}/${encodeS3Key(keyOrQuery)}`;
  const url = `${client.endpoint}${urlPath}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = body
    ? createHash("sha256").update(body).digest("hex")
    : EMPTY_SHA256;

  const host = new URL(client.endpoint).host;
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(extraHeaders ?? {}),
  };

  // Canonical request
  const { canonicalQuery, canonicalUri } = splitUriAndQuery(urlPath);
  const sortedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((h) => `${h}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h)!]).trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  // Derived signing key
  const kDate = hmac(`AWS4${client.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${client.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers: { ...headers, Authorization: authHeader },
    body: body && method === "PUT" ? new Uint8Array(body) : undefined,
  });
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** AWS-style URI encoding for keys: same as encodeURIComponent but with "/" preserved. */
function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");
}

function splitUriAndQuery(path: string): { canonicalUri: string; canonicalQuery: string } {
  const qIdx = path.indexOf("?");
  if (qIdx < 0) return { canonicalUri: path, canonicalQuery: "" };
  const uri = path.slice(0, qIdx);
  const qs = path.slice(qIdx + 1);
  // Canonical query: sort by key, then by value, URI-encode each
  const pairs = qs.split("&").map((p) => {
    const eq = p.indexOf("=");
    const k = eq < 0 ? p : p.slice(0, eq);
    const v = eq < 0 ? "" : p.slice(eq + 1);
    return [decodeURIComponent(k), decodeURIComponent(v)] as const;
  });
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalQuery = pairs
    .map(([k, v]) => `${encodeURIComponent(k).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}=${encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`)
    .join("&");
  return { canonicalUri: uri, canonicalQuery };
}
