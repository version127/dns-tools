import type { MetadataRoute } from "next";

import { allowIndexing, siteUrl } from "./site-config";

export default function robots(): MetadataRoute.Robots {
  if (!allowIndexing()) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/" }, sitemap: new URL("/sitemap.xml", siteUrl()).toString() };
}
