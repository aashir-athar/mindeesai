import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/chat/"] }],
    sitemap: `${env.SITE_URL}/sitemap.xml`,
  };
}
