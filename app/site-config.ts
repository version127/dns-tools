const fallbackSiteUrl = "http://localhost:1273";

export function siteUrl() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || fallbackSiteUrl);
  } catch {
    return new URL(fallbackSiteUrl);
  }
}

export function allowIndexing() {
  return process.env.DNS_TOOLS_ALLOW_INDEXING === "true";
}

export const publicRoutes = [
  "/",
  "/dns-lookup",
  "/dns-trace",
  "/dns-change-checker",
  "/nameserver-checker",
  "/dnssec-checker",
  "/soa-checker",
  "/caa-checker",
] as const;
