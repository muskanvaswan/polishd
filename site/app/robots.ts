import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/links";

export default function robots(): MetadataRoute.Robots {
  return {
    // /api only takes beacons. /polishd stays crawlable on purpose: its page
    // says noindex, and a crawler blocked here would never read that.
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
