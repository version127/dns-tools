import { NextResponse } from "next/server";
import { dnsClientKey, isSameOriginDnsRequest, readDnsJsonBody } from "@/lib/dns/api.ts";
import { isDnsResolver, lookupDns, normalizeSelection } from "@/lib/dns/lookup.ts";
import { consumeDnsLookupLimit, rateLimitCost } from "@/lib/dns/rate-limit.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...headers,
      },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginDnsRequest(request)) {
    return errorResponse(403, "cross_origin_request", "DNS lookups must come from this DNS Tools installation.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readDnsJsonBody(request);
  } catch (error) {
    return error instanceof Error && error.message === "request_too_large"
      ? errorResponse(413, "request_too_large", "The DNS lookup request is too large.")
      : errorResponse(400, "invalid_json", "Send a valid JSON lookup request.");
  }

  if ("do" in body || "cd" in body) {
    return errorResponse(400, "unsupported_option", "DNSSEC request flags cannot be changed in this release.");
  }
  if (typeof body.name !== "string") {
    return errorResponse(400, "invalid_name", "Enter a DNS name.");
  }
  if (!isDnsResolver(body.resolver)) {
    return errorResponse(400, "invalid_resolver", "Choose a supported DNS source.");
  }

  let selection;
  try {
    selection = normalizeSelection(body.selection);
  } catch (error) {
    return errorResponse(400, "invalid_selection", error instanceof Error ? error.message : "Choose a supported record type.");
  }

  const limit = consumeDnsLookupLimit(dnsClientKey(request), rateLimitCost(selection));
  if (!limit.allowed) {
    return errorResponse(429, "rate_limited", "Too many DNS lookups. Try again after the retry period.", {
      "retry-after": String(limit.retryAfterSeconds),
      "x-ratelimit-remaining": String(Math.min(limit.remainingRequests, limit.remainingUnits)),
    });
  }

  try {
    const result = await lookupDns(
      { name: body.name, selection, resolver: body.resolver },
      { signal: request.signal },
    );
    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-ratelimit-remaining": String(Math.min(limit.remainingRequests, limit.remainingUnits)),
      },
    });
  } catch (error) {
    return errorResponse(
      400,
      "invalid_lookup",
      error instanceof Error ? error.message : "The DNS lookup could not be validated.",
    );
  }
}
