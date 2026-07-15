import { NextResponse } from "next/server";
import { consumeDnsLookupLimit } from "@/lib/dns/rate-limit.ts";
import { normalizeTraceRecordType, traceDns } from "@/lib/dns/trace.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store", ...headers } },
  );
}

function requestHost(request: Request) {
  return request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")
    ?? new URL(request.url).host;
}

function isSameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return errorResponse(403, "cross_origin_request", "DNS traces must come from this DNS Tools installation.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return errorResponse(413, "request_too_large", "The DNS trace request is too large.");
  }

  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
    body = value as Record<string, unknown>;
  } catch {
    return errorResponse(400, "invalid_json", "Send a valid JSON trace request.");
  }
  if ("resolver" in body || "do" in body || "cd" in body || "all" in body) {
    return errorResponse(400, "unsupported_option", "A DNS trace starts at the root and accepts one record type.");
  }
  if (typeof body.name !== "string") {
    return errorResponse(400, "invalid_name", "Enter a domain or hostname.");
  }

  let recordType;
  try {
    recordType = normalizeTraceRecordType(body.recordType);
  } catch (error) {
    return errorResponse(400, "invalid_record_type", error instanceof Error ? error.message : "Choose one supported record type.");
  }

  const limit = consumeDnsLookupLimit(`trace:${clientKey(request)}`, 11);
  if (!limit.allowed) {
    return errorResponse(429, "rate_limited", "Too many DNS traces. Try again after the retry period.", {
      "retry-after": String(limit.retryAfterSeconds),
      "x-ratelimit-remaining": String(Math.min(limit.remainingRequests, limit.remainingUnits)),
    });
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const result = await traceDns({ name: body.name, recordType }, { signal: controller.signal });
    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-ratelimit-remaining": String(Math.min(limit.remainingRequests, limit.remainingUnits)),
      },
    });
  } catch (error) {
    const timedOut = controller.signal.aborted && !request.signal.aborted;
    return errorResponse(
      timedOut ? 504 : 400,
      timedOut ? "trace_timeout" : "invalid_trace",
      timedOut
        ? "The DNS trace took too long and was stopped safely."
        : error instanceof Error ? error.message : "The DNS trace could not be completed.",
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", onAbort);
  }
}
