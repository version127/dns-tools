import { NextResponse } from "next/server";
export { readDnsJsonBody } from "./request.ts";

export function dnsErrorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
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

export function isSameOriginDnsRequest(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

export function dnsClientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export function dnsJson(data: unknown, remaining: number) {
  return NextResponse.json(data, {
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-ratelimit-remaining": String(remaining),
    },
  });
}
