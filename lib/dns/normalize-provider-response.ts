import { normalizeAliasEdges } from "./alias-chain.ts";
import { canonicalDnsName } from "./normalize-name.ts";
import { recordTypeCode, recordTypeName } from "./record-types.ts";
import { responseCodeName } from "./response-codes.ts";
import type {
  DnsFlags,
  DnsQuestion,
  DnsQueryResult,
  DnsResolver,
  DnsWarning,
  NormalizedDnsRecord,
} from "./types.ts";

type ProviderRecord = {
  name?: unknown;
  type?: unknown;
  TTL?: unknown;
  data?: unknown;
};

type NormalizeProviderResponseInput = {
  provider: DnsResolver;
  requestedName: string;
  requestedType: string;
  rawResponse: unknown;
  cnameAsTerminal: boolean;
};

export function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function providerWarning(field: string, requestedType: string): DnsWarning {
  return {
    code: "provider_field_invalid",
    message: `The resolver returned an invalid ${field} field.`,
    requestedType,
  };
}

function ttlValue(value: unknown, warnings: DnsWarning[], requestedType: string) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  warnings.push(providerWarning("TTL", requestedType));
  return null;
}

function normalizeRecord(
  value: ProviderRecord,
  warnings: DnsWarning[],
  requestedType: string,
): NormalizedDnsRecord | null {
  if (!value || typeof value !== "object") return null;
  const ownerName = typeof value.name === "string" ? canonicalDnsName(value.name) : "";
  const typeCode = typeof value.type === "number" && Number.isInteger(value.type) ? value.type : null;
  const data = typeof value.data === "string" ? value.data.trim() : null;
  if (!ownerName || !data) {
    warnings.push(providerWarning("record", requestedType));
    return null;
  }
  return {
    ownerName,
    type: recordTypeName(typeCode),
    typeCode,
    value: data,
    resolverTtlSeconds: ttlValue(value.TTL, warnings, requestedType),
  };
}

function optionalRecords(
  value: unknown,
  field: string,
  warnings: DnsWarning[],
  requestedType: string,
): NormalizedDnsRecord[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    warnings.push(providerWarning(field, requestedType));
    return null;
  }
  return value
    .map((record) => normalizeRecord(record as ProviderRecord, warnings, requestedType))
    .filter((record): record is NormalizedDnsRecord => record !== null);
}

function answerRecords(
  value: unknown,
  warnings: DnsWarning[],
  requestedType: string,
) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push(providerWarning("Answer", requestedType));
    return [];
  }
  return value
    .map((record) => normalizeRecord(record as ProviderRecord, warnings, requestedType))
    .filter((record): record is NormalizedDnsRecord => record !== null);
}

function normalizeQuestions(value: unknown, warnings: DnsWarning[], requestedType: string): DnsQuestion[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    warnings.push(providerWarning("Question", requestedType));
    return null;
  }
  return value.flatMap((question) => {
    if (!question || typeof question !== "object") return [];
    const raw = question as { name?: unknown; type?: unknown };
    if (typeof raw.name !== "string") return [];
    const typeCode = typeof raw.type === "number" && Number.isInteger(raw.type) ? raw.type : null;
    return [{ name: canonicalDnsName(raw.name), type: recordTypeName(typeCode), typeCode }];
  });
}

function normalizeComments(value: unknown, warnings: DnsWarning[], requestedType: string) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  warnings.push(providerWarning("Comment", requestedType));
  return null;
}

function flagsFrom(raw: Record<string, unknown>, warnings: DnsWarning[], requestedType: string): DnsFlags {
  const mapping = [
    ["AD", "authenticatedData"],
    ["CD", "checkingDisabled"],
    ["RD", "recursionDesired"],
    ["RA", "recursionAvailable"],
    ["TC", "truncated"],
  ] as const;
  const flags = {} as DnsFlags;
  for (const [providerKey, normalizedKey] of mapping) {
    const value = raw[providerKey];
    flags[normalizedKey] = nullableBoolean(value);
    if (value !== undefined && value !== null && typeof value !== "boolean") {
      warnings.push(providerWarning(providerKey, requestedType));
    }
  }
  return flags;
}

export function normalizeProviderResponse({
  requestedName,
  requestedType,
  rawResponse,
  cnameAsTerminal,
}: NormalizeProviderResponseInput): DnsQueryResult {
  const warnings: DnsWarning[] = [];
  const raw = rawResponse && typeof rawResponse === "object"
    ? rawResponse as Record<string, unknown>
    : {};
  if (raw !== rawResponse) warnings.push(providerWarning("response", requestedType));

  const responseCodeNumber = typeof raw.Status === "number" && Number.isInteger(raw.Status)
    ? raw.Status
    : null;
  if (raw.Status !== undefined && responseCodeNumber === null) {
    warnings.push(providerWarning("Status", requestedType));
  }

  const answers = answerRecords(raw.Answer, warnings, requestedType);
  const cnameRecords = answers.filter((record) => record.typeCode === 5);
  const rawAliasEdges = cnameRecords.map((record) => ({
    from: record.ownerName,
    to: canonicalDnsName(record.value),
    resolverTtlSeconds: record.resolverTtlSeconds,
  }));
  const aliasResult = normalizeAliasEdges(requestedName, rawAliasEdges);
  warnings.push(...aliasResult.warnings.map((warning) => ({ ...warning, requestedType })));

  const requestedCode = recordTypeCode(requestedType);
  const terminalRecords = answers.filter((record) => {
    if (requestedType === "CNAME") return cnameAsTerminal && record.typeCode === 5;
    return record.typeCode === requestedCode;
  });

  const outcome = responseCodeNumber === 3
    ? "nxdomain"
    : responseCodeNumber !== 0
      ? "dns_error"
      : terminalRecords.length > 0
        ? "found"
        : "no_answer";

  return {
    requestedName,
    requestedType,
    responseCode: responseCodeName(responseCodeNumber),
    responseCodeNumber,
    outcome,
    flags: flagsFrom(raw, warnings, requestedType),
    questions: normalizeQuestions(raw.Question, warnings, requestedType),
    terminalRecords,
    aliasChain: aliasResult.aliasChain,
    authorityRecords: optionalRecords(raw.Authority, "Authority", warnings, requestedType),
    additionalRecords: optionalRecords(raw.Additional, "Additional", warnings, requestedType),
    comments: normalizeComments(raw.Comment, warnings, requestedType),
    warnings,
    error: null,
    rawResponse,
  };
}
