import { dnsClientKey, dnsErrorResponse, dnsJson, isSameOriginDnsRequest, readDnsJsonBody } from "@/lib/dns/api.ts";
import { checkSoaConsistency } from "@/lib/dns/diagnostics.ts";
import { consumeDnsLookupLimit } from "@/lib/dns/rate-limit.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginDnsRequest(request)) return dnsErrorResponse(403, "cross_origin_request", "DNS checks must come from this DNS Tools installation.");
  let body: Record<string, unknown>;
  try { body = await readDnsJsonBody(request); } catch { return dnsErrorResponse(400, "invalid_request", "Send a valid SOA check request."); }
  if (typeof body.name !== "string") return dnsErrorResponse(400, "invalid_name", "Enter a domain or hostname.");
  const limit = consumeDnsLookupLimit(`soa:${dnsClientKey(request)}`, 24);
  if (!limit.allowed) return dnsErrorResponse(429, "rate_limited", "Too many SOA checks. Try again shortly.", { "retry-after": String(limit.retryAfterSeconds) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try { return dnsJson(await checkSoaConsistency(body.name, { signal: controller.signal }), Math.min(limit.remainingRequests, limit.remainingUnits)); }
  catch (error) { return dnsErrorResponse(controller.signal.aborted ? 504 : 400, controller.signal.aborted ? "check_timeout" : "check_failed", controller.signal.aborted ? "The SOA check took too long and was stopped safely." : error instanceof Error ? error.message : "The SOA check could not be completed."); }
  finally { clearTimeout(timeout); }
}
