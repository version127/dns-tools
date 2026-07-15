import { recordFields } from "./format-record.ts";
import {
  dnsForwardRecordTypes,
  type DnsLookupResponse,
  type NormalizedDnsRecord,
} from "./types.ts";

export function caaPropertyCounts(records: NormalizedDnsRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.type !== "CAA") continue;
    const property = recordFields(record).find((field) => field.label === "Property")?.value.toLowerCase();
    if (property) counts.set(property, (counts.get(property) ?? 0) + 1);
  }
  return [...counts].map(([property, count]) => ({ property, count }));
}

export function traceLinkForLookup(
  result: Pick<DnsLookupResponse, "query" | "queryResults">,
): { href: string; reason: "nxdomain" | "servfail" } | null {
  const issue = result.queryResults.find((query) => (
    query.responseCode === "SERVFAIL" || query.outcome === "nxdomain"
  ));
  if (!issue || !dnsForwardRecordTypes.includes(issue.requestedType as (typeof dnsForwardRecordTypes)[number])) {
    return null;
  }

  const params = new URLSearchParams({
    name: result.query.normalizedName,
    type: issue.requestedType,
  });
  return {
    href: `/dns-trace?${params.toString()}`,
    reason: issue.responseCode === "SERVFAIL" ? "servfail" : "nxdomain",
  };
}
