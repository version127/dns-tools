import type { MetadataRoute } from "next";

import { allowIndexing, publicRoutes, siteUrl } from "./site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!allowIndexing()) return [];
  return publicRoutes.map((route) => ({ url: new URL(route, siteUrl()).toString(), changeFrequency: "monthly", priority: route === "/" ? 1 : 0.8 }));
}
