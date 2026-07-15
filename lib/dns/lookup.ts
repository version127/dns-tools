import { buildUnifiedAliasChain } from "./alias-chain.ts";
import { discoverAuthoritativeTarget, queryAuthoritative, type AuthoritativeTarget } from "./authoritative.ts";
import { queryPublicResolver } from "./doh.ts";
import { enrichDnsResults } from "./network-enrichment.ts";
import { normalizeDnsInput, reverseDnsName } from "./normalize-name.ts";
import { normalizeProviderResponse } from "./normalize-provider-response.ts";
import { isDnsResolver, resolverLabel } from "./resolvers.ts";
import type {
  DnsFlags,
  DnsLookupRequest,
  DnsLookupResponse,
  DnsQueryResult,
  DnsRecordType,
  DnsResolver,
  DnsSelection,
  DnsWarning,
} from "./types.ts";
import { dnsForwardRecordTypes, dnsRecordTypes } from "./types.ts";

export const ALL_RECORD_TYPES: DnsRecordType[] = [...dnsForwardRecordTypes];

type LookupOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const emptyFlags: DnsFlags = {
  authenticatedData: null,
  checkingDisabled: null,
  recursionDesired: null,
  recursionAvailable: null,
  truncated: null,
};

export { isDnsResolver, resolverLabel } from "./resolvers.ts";

export function normalizeSelection(value: unknown): DnsSelection {
  if (value === "all" || value === "common") return "all";
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  if (dnsRecordTypes.includes(upper as DnsRecordType)) return upper as DnsRecordType;
  throw new Error("Choose a supported DNS record type.");
}

function failedResult(name: string, type: string, outcome: "provider_error" | "timeout", code: string, message: string, rawResponse: unknown): DnsQueryResult {
  return {
    requestedName: name,
    requestedType: type,
    responseCode: null,
    responseCodeNumber: null,
    outcome,
    flags: { ...emptyFlags },
    questions: null,
    terminalRecords: [],
    aliasChain: [],
    authorityRecords: null,
    additionalRecords: null,
    comments: null,
    warnings: [],
    error: { code, message },
    rawResponse,
  };
}

async function fetchOne(
  name: string,
  type: DnsRecordType,
  resolver: DnsResolver,
  cnameAsTerminal: boolean,
  options: LookupOptions,
  authoritativeTarget?: Promise<AuthoritativeTarget>,
) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    resolver === "authoritative" ? (options.timeoutMs ?? 3000) * 4 : options.timeoutMs ?? 3000,
  );
  const onParentAbort = () => timeoutController.abort();
  options.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const rawResponse = resolver === "authoritative"
      ? await queryAuthoritative(name, type, await (authoritativeTarget as Promise<AuthoritativeTarget>), {
        signal: timeoutController.signal,
        timeoutMs: options.timeoutMs,
      })
      : await queryPublicResolver(name, type, resolver, {
        fetchImpl: options.fetchImpl,
        signal: timeoutController.signal,
      });
    return normalizeProviderResponse({
      provider: resolver,
      requestedName: name,
      requestedType: type,
      rawResponse,
      cnameAsTerminal,
    });
  } catch (error) {
    const timedOut = timeoutController.signal.aborted;
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : null;
    const tooLarge = error instanceof Error && error.message.includes("oversized");
    const unavailableMessage = error instanceof Error && error.message
      ? error.message
      : `${resolverLabel(resolver)} could not be reached.`;
    return failedResult(
      name,
      type,
      timedOut ? "timeout" : "provider_error",
      timedOut
        ? "provider_timeout"
        : status === 429
          ? "provider_rate_limited"
          : tooLarge
            ? "provider_response_too_large"
            : status
              ? "provider_http_error"
              : "provider_unavailable",
      timedOut
        ? `${resolverLabel(resolver)} did not answer within the lookup timeout.`
        : unavailableMessage,
      error instanceof Error ? { name: error.name, message: error.message } : null,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onParentAbort);
  }
}

export async function lookupDns(
  request: DnsLookupRequest,
  options: LookupOptions = {},
): Promise<DnsLookupResponse> {
  if (!isDnsResolver(request.resolver)) throw new Error("Choose a supported DNS source.");
  const selection = normalizeSelection(request.selection);
  const normalized = normalizeDnsInput(request.name);
  if (selection === "PTR" && normalized.inputKind !== "ip") {
    throw new Error("Enter a valid IPv4 or IPv6 address for a PTR lookup.");
  }
  if (selection !== "PTR" && normalized.inputKind === "ip") {
    throw new Error("Choose PTR to look up an IP address.");
  }
  const dnsQuestionName = selection === "PTR" ? reverseDnsName(normalized.normalizedName) : normalized.normalizedName;
  const recordTypes = selection === "all" ? ALL_RECORD_TYPES : [selection];
  const started = performance.now();

  const discoverTarget = (type: DnsRecordType) => {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onParentAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), (options.timeoutMs ?? 3000) * 3);
    const bootstrapQuery = (name: string, queryType: DnsRecordType) => queryPublicResolver(name, queryType, "cloudflare", {
      fetchImpl: options.fetchImpl,
      signal: controller.signal,
    });
    return discoverAuthoritativeTarget(dnsQuestionName, type, bootstrapQuery).finally(() => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onParentAbort);
    });
  };
  const normalTarget = request.resolver === "authoritative" && recordTypes.some((type) => type !== "DS")
    ? discoverTarget("A")
    : undefined;
  const dsTarget = request.resolver === "authoritative" && recordTypes.includes("DS")
    ? discoverTarget("DS")
    : undefined;

  const queryResults = await Promise.all(recordTypes.map((type) => fetchOne(
    dnsQuestionName,
    type,
    request.resolver,
    selection === "CNAME",
    options,
    type === "DS" ? dsTarget : normalTarget,
  )));

  const aliasObservations = queryResults
    .filter((result) => result.aliasChain.length > 0)
    .map((result) => ({ requestedType: result.requestedType, aliasChain: result.aliasChain }));
  const unified = buildUnifiedAliasChain(dnsQuestionName, aliasObservations);
  const failures = queryResults.filter((result) => result.outcome === "provider_error" || result.outcome === "timeout");
  const warnings: DnsWarning[] = [...unified.warnings];
  if (failures.length > 0 && failures.length < queryResults.length) {
    warnings.push({
      code: "partial_lookup_failure",
      message: `${failures.length} of ${queryResults.length} DNS queries could not be completed.`,
    });
  }
  const enrichment = await enrichDnsResults(queryResults, {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    timeoutMs: Math.min(options.timeoutMs ?? 2500, 2500),
  });

  return {
    query: {
      originalInput: normalized.originalInput,
      normalizedName: normalized.normalizedName,
      dnsQuestionName,
      selection,
      resolver: request.resolver,
      dnssecRecordsRequested: false,
      checkingDisabled: false,
    },
    checkedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    aliasChain: unified.aliasChain,
    aliasObservations,
    addressDetails: enrichment.addressDetails,
    nameserverAddresses: enrichment.nameserverAddresses,
    queryResults,
    warnings,
  };
}
