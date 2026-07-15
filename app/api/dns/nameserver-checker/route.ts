import { dnsClientKey, dnsErrorResponse, dnsJson, isSameOriginDnsRequest, readDnsJsonBody } from "@/lib/dns/api.ts";
import { checkDelegation } from "@/lib/dns/diagnostics.ts";
import { consumeDnsLookupLimit } from "@/lib/dns/rate-limit.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginDnsRequest(request)) return dnsErrorResponse(403, "cross_origin_request", "DNS checks must come from this DNS Tools installation.");
  let body: Record<string, unknown>;
  try { body = await readDnsJsonBody(request); }
  catch (error) { return dnsErrorResponse(error instanceof Error && error.message === "request_too_large" ? 413 : 400, "invalid_request", "Send a small, valid nameserver check request."); }
  if (typeof body.name !== "string") return dnsErrorResponse(400, "invalid_name", "Enter a domain or hostname.");
  const limit = consumeDnsLookupLimit(`nameserver:${dnsClientKey(request)}`, 24);
  if (!limit.allowed) return dnsErrorResponse(429, "rate_limited", "Too many nameserver checks. Try again shortly.", { "retry-after": String(limit.retryAfterSeconds) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    return dnsJson(await checkDelegation(body.name, { signal: controller.signal }), Math.min(limit.remainingRequests, limit.remainingUnits));
  } catch (error) {
    return dnsErrorResponse(controller.signal.aborted ? 504 : 400, controller.signal.aborted ? "check_timeout" : "check_failed", controller.signal.aborted ? "The nameserver check took too long and was stopped safely." : error instanceof Error ? error.message : "The nameserver check could not be completed.");
  } finally { clearTimeout(timeout); }
}
