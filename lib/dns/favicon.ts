export function websiteFaviconUrl(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  const looksLikeIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized);
  const looksLikeIpv6 = normalized.includes(":");
  if (looksLikeIpv4 || looksLikeIpv6) return null;
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => !label || label.startsWith("_"))) return null;

  try {
    const url = new URL(`https://${normalized}/favicon.ico`);
    return url.hostname === normalized ? url.toString() : null;
  } catch {
    return null;
  }
}
