/**
 * MindeesAI — Next.js 16 configuration.
 *
 * Why each block exists:
 *  - `reactCompiler`: auto-memoise React 19 components without `useMemo` / `useCallback` noise.
 *  - `ppr` (Partial Prerendering): serve the static shell instantly, stream dynamic chat in.
 *  - `serverActions.bodySizeLimit`: chat uploads (images, audio) can exceed the 1MB default.
 *  - `images.remotePatterns`: avatars + research thumbnails come from arbitrary hosts.
 *  - Native modules: `@lancedb/lancedb`, `onnxruntime-node`, and
 *    `@huggingface/transformers` all moved to the sidecar service
 *    (scripts/sidecar/). The main app no longer bundles them, so the
 *    Cloudflare Workers build can succeed.
 */
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // OpenNext (used for Cloudflare Workers deploy) requires Next.js's
  // standalone output mode — it reads `.next/standalone/.next/server/...`
  // artifacts when bundling the Worker.
  output: "standalone",
  // reactCompiler moved out of `experimental` in Next 16; leaving it off here so
  // the build is portable across plain Next and the @next/babel-plugin-react-compiler
  // setup. Enable later via a top-level `reactCompiler: true` once stable.
  experimental: {
    // Partial Prerendering is now toggled via the top-level `cacheComponents`
    // option in Next 16. We leave it off for now because it requires removing
    // every `export const dynamic = "force-dynamic"` declaration from API routes.
    // Re-enable later once routes are migrated to the new `'use cache'` model.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**" }, // research thumbnails come from anywhere
    ],
  },
  // Headers shipped on every response
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;
