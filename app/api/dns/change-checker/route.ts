import { checkDnsChange, normalizeChangeRecordType } from "@/lib/dns/diagnostics.ts";
import { consumeDnsLookupLimit } from "@/lib/dns/rate-limit.ts";
import { dnsClientKey, dnsErrorResponse, dnsJson, isSameOriginDnsRequest, readDnsJsonBody } from "@/lib/dns/api.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginDnsRequest(request)) return dnsErrorResponse(403, "cross_origin_request", "DNS checks must come from this DNS Tools installation.");
  let body: Record<string, unknown>;
  try {
    body = await readDnsJsonBody(request);
  } catch (error) {
    return dnsErrorResponse(error instanceof Error && error.message === "request_too_large" ? 413 : 400, "invalid_request", "Send a small, valid DNS change request.");
  }
  if (typeof body.name !== "string") return dnsErrorResponse(400, "invalid_name", "Enter a domain or hostname.");
  let recordType;
  try {
    recordType = normalizeChangeRecordType(body.recordType);
  } catch (error) {
    return dnsErrorResponse(400, "invalid_record_type", error instanceof Error ? error.message : "Choose one supported record type.");
  }
  if (body.expectedAnswer !== undefined && typeof body.expectedAnswer !== "string") return dnsErrorResponse(400, "invalid_expected_answer", "The expected answer must be text.");
  const limit = consumeDnsLookupLimit(`change:${dnsClientKey(request)}`, 24);
  if (!limit.allowed) return dnsErrorResponse(429, "rate_limited", "Too many DNS checks. Try again shortly.", { "retry-after": String(limit.retryAfterSeconds) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const result = await checkDnsChange({ name: body.name, recordType, expectedAnswer: body.expectedAnswer as string | undefined }, { signal: controller.signal });
    return dnsJson(result, Math.min(limit.remainingRequests, limit.remainingUnits));
  } catch (error) {
    return dnsErrorResponse(controller.signal.aborted ? 504 : 400, controller.signal.aborted ? "check_timeout" : "check_failed", controller.signal.aborted ? "The DNS check took too long and was stopped safely." : error instanceof Error ? error.message : "The DNS check could not be completed.");
  } finally {
    clearTimeout(timeout);
  }
}
