import { type NextRequest, NextResponse } from "next/server";

import { allowIndexing } from "./app/site-config";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (!allowIndexing() || request.nextUrl.search) response.headers.set("x-robots-tag", "noindex, follow");
  return response;
}
