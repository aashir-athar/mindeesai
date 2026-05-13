/**
 * MindeesAI — Next.js 16 configuration.
 *
 * Why each block exists:
 *  - `reactCompiler`: auto-memoise React 19 components without `useMemo` / `useCallback` noise.
 *  - `ppr` (Partial Prerendering): serve the static shell instantly, stream dynamic chat in.
 *  - `serverActions.bodySizeLimit`: chat uploads (images, audio) can exceed the 1MB default.
 *  - `images.remotePatterns`: avatars + research thumbnails come from arbitrary hosts.
 *  - `webpack`: silence the `node:` warning that `@lancedb/lancedb` emits in Edge bundles.
 */
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    reactCompiler: true,
    ppr: "incremental",
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Keep server-component instrumentation lean
    instrumentationHook: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**" }, // research thumbnails come from anywhere
    ],
  },
  // LanceDB is server-only; never let it leak into client bundles
  serverExternalPackages: ["@lancedb/lancedb", "apache-arrow"],
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
