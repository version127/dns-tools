import { isIP } from "node:net";
import { queryDirectDnsServer, type DirectDnsTarget } from "./authoritative.ts";
import type { RawDnsWireRecord, RawDnsWireResponse } from "./dns-wire.ts";
import { queryPublicResolver } from "./doh.ts";
import { safeDnsErrorMessage } from "./errors.ts";
import { canonicalDnsName, normalizeDnsInput } from "./normalize-name.ts";
import { recordTypeCode, recordTypeName } from "./record-types.ts";
import { dnsResolverProfiles, resolverLabel } from "./resolvers.ts";
import { traceDns } from "./trace.ts";
export { negativeCacheTtlSeconds } from "./diagnostic-presentation.ts";
import { enrichDnsAddresses } from "./network-enrichment.ts";
import type { DnsAddressDetail, DnsRecordType, DnsResolver, NormalizedDnsRecord } from "./types.ts";

export type DnsDiagnosticQuery = typeof queryDirectDnsServer;
export type PublicDiagnosticQuery = typeof queryPublicResolver;

export type DiagnosticOptions = {
  directQuery?: DnsDiagnosticQuery;
  publicQuery?: PublicDiagnosticQuery;
  signal?: AbortSignal;
  timeoutMs?: number;
  addressEnrichment?: typeof enrichDnsAddresses;
  ipv6ConnectivityCheck?: () => Promise<boolean>;
};

export type NameserverAddress = {
  hostname: string;
  addresses: string[];
};

export type DelegationObservation = {
  server: DirectDnsTarget;
  responseCode: string | null;
  authoritative: boolean | null;
  nameservers: string[];
  glue: Array<{ hostname: string; address: string; ttlSeconds: number | null }>;
  error: string | null;
  rawResponse: RawDnsWireResponse | null;
};

export type NameserverReachability = {
  server: DirectDnsTarget;
  skippedReason: "checker_ipv6_unavailable" | null;
  udp: { reachable: boolean; authoritative: boolean | null; responseCode: string | null; error: string | null };
  tcp: { reachable: boolean; authoritative: boolean | null; responseCode: string | null; error: string | null };
  soa: SoaRecord | null;
  rawResponses: { udp: RawDnsWireResponse | null; tcp: RawDnsWireResponse | null };
};

export type NameserverAddressObservation = {
  hostname: string;
  server: DirectDnsTarget;
  addresses: string[];
  authoritative: boolean | null;
  error: string | null;
  rawResponses: { A: RawDnsWireResponse | null; AAAA: RawDnsWireResponse | null };
};

export type DelegationCheck = {
  checkedAt: string;
  durationMs: number;
  inputName: string;
  zone: string;
  parentZone: string;
  ipv6Connectivity: boolean | null;
  parentNameservers: NameserverAddress[];
  parentObservations: DelegationObservation[];
  parentDelegatedNameservers: string[];
  parentGlue: Array<{ hostname: string; address: string; ttlSeconds: number | null }>;
  childPublishedNameservers: string[];
  childObservations: DelegationObservation[];
  nameserverAddresses: NameserverAddress[];
  authoritativeAddressObservations: NameserverAddressObservation[];
  addressDetails: DnsAddressDetail[];
  reachability: NameserverReachability[];
  findings: string[];
  notes: string[];
};

export type SoaRecord = {
  ownerName: string;
  primaryNameserver: string;
  responsibleMailbox: string;
  serial: number;
  refreshSeconds: number;
  retrySeconds: number;
  expireSeconds: number;
  minimumSeconds: number;
  ttlSeconds: number | null;
};

export const CHANGE_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY"] as const;
export type ChangeRecordType = (typeof CHANGE_RECORD_TYPES)[number];

export function normalizeDiagnosticName(value: string) {
  const normalized = normalizeDnsInput(value);
  if (normalized.inputKind === "ip") throw new Error("Enter a domain or hostname rather than an IP address.");
  return normalized.normalizedName;
}

export function normalizeChangeRecordType(value: unknown): ChangeRecordType {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  if (CHANGE_RECORD_TYPES.includes(normalized as ChangeRecordType)) return normalized as ChangeRecordType;
  throw new Error("Choose one supported DNS record type.");
}

export function dnsResponseCode(status: number | null) {
  if (status === null) return null;
  return ["NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"][status] ?? `RCODE${status}`;
}

export function normalizeWireRecord(record: RawDnsWireRecord): NormalizedDnsRecord {
  return {
    ownerName: canonicalDnsName(record.name),
    type: recordTypeName(record.type),
    typeCode: record.type,
    value: record.data,
    resolverTtlSeconds: typeof record.TTL === "number" && Number.isFinite(record.TTL) ? record.TTL : null,
  };
}

function unique(values: string[]) {
  return [...new Set(values.map(canonicalDnsName))].sort();
}

function isIpv6Target(target: DirectDnsTarget) {
  return isIP(target.address) === 6;
}

function checkerNetworkCannotReachIpv6(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\b(?:ENETUNREACH|EADDRNOTAVAIL|EAFNOSUPPORT|EPROTONOSUPPORT)\b/.test(message);
}

async function detectIpv6Connectivity(options: DiagnosticOptions) {
  if (options.ipv6ConnectivityCheck) return options.ipv6ConnectivityCheck();
  try {
    await (options.directQuery ?? queryDirectDnsServer)(".", "NS", {
      hostname: "one.one.one.one",
      address: "2606:4700:4700::1111",
    }, {
      signal: options.signal,
      timeoutMs: Math.min(options.timeoutMs ?? 2500, 1500),
      transport: "udp",
    });
    return true;
  } catch (error) {
    // Only a local route/socket failure proves the checker cannot use IPv6.
    // A timeout or remote DNS error is inconclusive, so the real targets still run.
    return !checkerNetworkCannotReachIpv6(error);
  }
}

function skippedIpv6Reachability(target: DirectDnsTarget): NameserverReachability {
  return {
    server: target,
    skippedReason: "checker_ipv6_unavailable",
    udp: { reachable: false, authoritative: null, responseCode: null, error: null },
    tcp: { reachable: false, authoritative: null, responseCode: null, error: null },
    soa: null,
    rawResponses: { udp: null, tcp: null },
  };
}

function nsRecords(records: RawDnsWireRecord[]) {
  return unique(records.filter((record) => record.type === 2).map((record) => record.data));
}

function addressesFor(records: RawDnsWireRecord[], nameservers: string[]) {
  const wanted = new Set(nameservers);
  return records
    .filter((record) => (record.type === 1 || record.type === 28) && wanted.has(canonicalDnsName(record.name)))
    .map((record) => ({
      hostname: canonicalDnsName(record.name),
      address: record.data,
      ttlSeconds: record.TTL,
    }));
}

export function parseSoaRecord(record: RawDnsWireRecord | NormalizedDnsRecord): SoaRecord | null {
  const type = "typeCode" in record ? record.typeCode : record.type;
  if (type !== 6) return null;
  const normalized = "value" in record;
  const parts = (normalized ? record.value : record.data).trim().split(/\s+/);
  if (parts.length < 7) return null;
  const numbers = parts.slice(2, 7).map(Number);
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return {
    ownerName: canonicalDnsName(normalized ? record.ownerName : record.name),
    primaryNameserver: canonicalDnsName(parts[0]),
    responsibleMailbox: canonicalDnsName(parts[1]),
    serial: numbers[0],
    refreshSeconds: numbers[1],
    retrySeconds: numbers[2],
    expireSeconds: numbers[3],
    minimumSeconds: numbers[4],
    ttlSeconds: "TTL" in record ? record.TTL : record.resolverTtlSeconds,
  };
}

export function compareSerials(left: number, right: number): "same" | "left-newer" | "right-newer" | "undefined" {
  const modulo = 2 ** 32;
  const delta = ((left - right) % modulo + modulo) % modulo;
  if (delta === 0) return "same";
  if (delta === 2 ** 31) return "undefined";
  return delta < 2 ** 31 ? "left-newer" : "right-newer";
}

async function resolveNameserverAddresses(
  hostnames: string[],
  options: DiagnosticOptions,
): Promise<NameserverAddress[]> {
  const publicQuery = options.publicQuery ?? queryPublicResolver;
  return Promise.all(unique(hostnames).map(async (hostname) => {
    const addresses: string[] = [];
    for (const type of ["A", "AAAA"] as const) {
      try {
        const response = await publicQuery(hostname, type, "cloudflare", { signal: options.signal });
        for (const record of response.Answer) {
          if (record.type === recordTypeCode(type)) addresses.push(record.data);
        }
      } catch {
        // A nameserver can have just one address family or one lookup may fail.
      }
    }
    return { hostname, addresses: [...new Set(addresses)] };
  }));
}

async function queryObservation(
  zone: string,
  target: DirectDnsTarget,
  options: DiagnosticOptions,
): Promise<DelegationObservation> {
  try {
    const response = await (options.directQuery ?? queryDirectDnsServer)(zone, "NS", target, {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 2500,
    });
    const nameservers = nsRecords([...response.Answer, ...response.Authority]);
    return {
      server: target,
      responseCode: dnsResponseCode(response.Status),
      authoritative: response.AA,
      nameservers,
      glue: addressesFor(response.Additional, nameservers),
      error: null,
      rawResponse: response,
    };
  } catch (error) {
    return {
      server: target,
      responseCode: null,
      authoritative: null,
      nameservers: [],
      glue: [],
      error: safeDnsErrorMessage(error, "The nameserver did not answer."),
      rawResponse: null,
    };
  }
}

async function reachabilityCheck(
  zone: string,
  target: DirectDnsTarget,
  options: DiagnosticOptions,
): Promise<NameserverReachability> {
  const directQuery = options.directQuery ?? queryDirectDnsServer;
  async function one(transport: "udp" | "tcp") {
    try {
      const raw = await directQuery(zone, "SOA", target, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 2500,
        transport,
      });
      return {
        result: { reachable: true, authoritative: raw.AA, responseCode: dnsResponseCode(raw.Status), error: null },
        raw,
      };
    } catch (error) {
      return {
        result: { reachable: false, authoritative: null, responseCode: null, error: safeDnsErrorMessage(error, "The nameserver did not answer.") },
        raw: null,
      };
    }
  }
  const [udp, tcp] = await Promise.all([one("udp"), one("tcp")]);
  const soaRecord = [...(udp.raw?.Answer ?? []), ...(tcp.raw?.Answer ?? [])].find((record) => record.type === 6);
  return {
    server: target,
    skippedReason: null,
    udp: udp.result,
    tcp: tcp.result,
    soa: soaRecord ? parseSoaRecord(soaRecord) : null,
    rawResponses: { udp: udp.raw, tcp: tcp.raw },
  };
}

function targetsFrom(addresses: NameserverAddress[]) {
  return addresses.flatMap(({ hostname, addresses: values }) => values.map((address) => ({ hostname, address })));
}

async function authoritativeAddressObservation(
  hostname: string,
  server: DirectDnsTarget,
  options: DiagnosticOptions,
): Promise<NameserverAddressObservation> {
  const directQuery = options.directQuery ?? queryDirectDnsServer;
  async function one(type: "A" | "AAAA") {
    try {
      const raw = await directQuery(hostname, type, server, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 2500,
      });
      const typeCode = recordTypeCode(type);
      return {
        addresses: raw.Answer.filter((record) => record.type === typeCode && canonicalDnsName(record.name) === hostname).map((record) => record.data),
        authoritative: raw.AA,
        error: null,
        raw,
      };
    } catch (error) {
      return {
        addresses: [],
        authoritative: null,
        error: safeDnsErrorMessage(error, "The nameserver did not answer."),
        raw: null,
      };
    }
  }
  const [ipv4, ipv6] = await Promise.all([one("A"), one("AAAA")]);
  return {
    hostname,
    server,
    addresses: [...new Set([...ipv4.addresses, ...ipv6.addresses])],
    authoritative: ipv4.authoritative === true || ipv6.authoritative === true
      ? true
      : ipv4.authoritative === false || ipv6.authoritative === false
        ? false
        : null,
    error: ipv4.error && ipv6.error ? `${ipv4.error} ${ipv6.error}` : null,
    rawResponses: { A: ipv4.raw, AAAA: ipv6.raw },
  };
}

type DelegationAssessmentInput = Pick<DelegationCheck,
  "zone" | "parentDelegatedNameservers" | "childPublishedNameservers" | "parentGlue" |
  "nameserverAddresses" | "reachability" | "authoritativeAddressObservations" | "addressDetails" | "ipv6Connectivity"
>;

export function assessDelegation(input: DelegationAssessmentInput) {
  const findings: string[] = [];
  const notes: string[] = [];
  const parentSet = new Set(input.parentDelegatedNameservers);
  const childSet = new Set(input.childPublishedNameservers);
  for (const hostname of parentSet) if (!childSet.has(hostname)) findings.push(`${hostname} appears at the parent but not in the zone's own NS records.`);
  for (const hostname of childSet) if (!parentSet.has(hostname)) findings.push(`${hostname} appears in the zone but not at the parent.`);
  for (const hostname of parentSet) {
    const isInZone = hostname === input.zone || hostname.endsWith(`.${input.zone}`);
    const glue = input.parentGlue.filter((record) => record.hostname === hostname).map((record) => record.address);
    if (isInZone && !glue.length) {
      findings.push(`${hostname} is inside ${input.zone}, but the parent referral did not include the required glue address.`);
      continue;
    }
    const authoritativeAddresses = [...new Set(input.authoritativeAddressObservations
      .filter((observation) => observation.hostname === hostname && observation.authoritative === true)
      .flatMap((observation) => observation.addresses))].sort();
    if (isInZone && glue.length && authoritativeAddresses.length) {
      const parentOnly = glue.filter((address) => !authoritativeAddresses.includes(address));
      const zoneOnly = authoritativeAddresses.filter((address) => !glue.includes(address));
      if (parentOnly.length || zoneOnly.length) {
        findings.push(`${hostname} has different addresses in the parent glue and its authoritative A or AAAA records. Parent only: ${parentOnly.join(", ") || "none"}. Authoritative only: ${zoneOnly.join(", ") || "none"}.`);
      }
    }
  }
  for (const nameserver of input.nameserverAddresses) {
    if (!nameserver.addresses.length) findings.push(`${nameserver.hostname} did not resolve to a public IPv4 or IPv6 address.`);
  }
  for (const result of input.reachability) {
    if (result.skippedReason === "checker_ipv6_unavailable") continue;
    if (!result.udp.reachable) findings.push(`${result.server.hostname} did not answer over UDP at ${result.server.address}.`);
    if (!result.tcp.reachable) findings.push(`${result.server.hostname} did not answer over TCP at ${result.server.address}.`);
    if ((result.udp.reachable || result.tcp.reachable) && result.udp.authoritative !== true && result.tcp.authoritative !== true) {
      findings.push(`${result.server.hostname} answered at ${result.server.address}, but did not claim authority for ${input.zone}.`);
    }
  }

  if (input.ipv6Connectivity === false) {
    notes.push("IPv6 checks were skipped because this checker does not have IPv6 connectivity.");
  }

  const hostnamesByAddress = new Map<string, string[]>();
  for (const nameserver of input.nameserverAddresses) for (const address of nameserver.addresses) {
    hostnamesByAddress.set(address, [...new Set([...(hostnamesByAddress.get(address) ?? []), nameserver.hostname])]);
  }
  for (const [address, hostnames] of hostnamesByAddress) {
    if (hostnames.length > 1) findings.push(`${hostnames.join(" and ")} use the same IP address, ${address}. Separate names can still fail together when they share one server.`);
  }

  if (input.nameserverAddresses.length > 1) {
    const usedAddresses = new Set(input.nameserverAddresses.flatMap((entry) => entry.addresses));
    const details = input.addressDetails.filter((detail) => usedAddresses.has(detail.address));
    const knownAsns = [...new Set(details.flatMap((detail) => detail.asn === null ? [] : [detail.asn]))];
    const knownPrefixes = [...new Set(details.flatMap((detail) => detail.prefix ? [detail.prefix] : []))];
    if (details.length && knownAsns.length === 1 && details.every((detail) => detail.asn === knownAsns[0])) {
      const networkName = details.find((detail) => detail.networkName)?.networkName;
      notes.push(`Every discovered nameserver address belongs to AS${knownAsns[0]}${networkName ? ` (${networkName})` : ""}. This identifies the network operator, not one physical server or location.`);
    }
    if (details.length && knownPrefixes.length === 1 && details.every((detail) => detail.prefix === knownPrefixes[0])) {
      notes.push(`Every discovered nameserver address is inside ${knownPrefixes[0]}. Separate networks give a delegation more room to survive a routing problem.`);
    }
  }
  return { findings, notes };
}

export async function checkDelegation(nameInput: string, options: DiagnosticOptions = {}): Promise<DelegationCheck> {
  const startedAt = Date.now();
  const inputName = normalizeDiagnosticName(nameInput);
  const trace = await traceDns({ name: inputName, recordType: "SOA" }, {
    queryImpl: options.directQuery,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  const referralSteps = trace.steps.filter((step) => step.outcome === "referral" && step.delegatedZone);
  const delegation = referralSteps.at(-1);
  if (!delegation?.delegatedZone) throw new Error("The DNS delegation could not be discovered from the root.");
  const zone = delegation.delegatedZone;
  const parentZone = delegation.zone;

  const publicQuery = options.publicQuery ?? queryPublicResolver;
  const parentNsResponse = await publicQuery(parentZone, "NS", "cloudflare", { signal: options.signal });
  const parentNameserverNames = nsRecords([...parentNsResponse.Answer, ...parentNsResponse.Authority]);
  const parentNameservers = await resolveNameserverAddresses(parentNameserverNames, options);
  const parentTargets = targetsFrom(parentNameservers);
  let ipv6Connectivity: boolean | null = parentTargets.some(isIpv6Target) ? await detectIpv6Connectivity(options) : null;
  const canQuery = (target: DirectDnsTarget) => !isIpv6Target(target) || ipv6Connectivity !== false;
  const parentObservations = await Promise.all(parentTargets.filter(canQuery).map((target) => queryObservation(zone, target, options)));

  const parentDelegatedNameservers = unique(parentObservations.flatMap((observation) => observation.nameservers).concat(delegation.nameservers));
  const parentGlue = [
    ...delegation.glueRecords.map((record) => ({ hostname: record.ownerName, address: record.value, ttlSeconds: record.resolverTtlSeconds })),
    ...parentObservations.flatMap((observation) => observation.glue),
  ].filter((value, index, values) => values.findIndex((candidate) => candidate.hostname === value.hostname && candidate.address === value.address) === index);

  const delegatedAddresses = await resolveNameserverAddresses(parentDelegatedNameservers, options);
  const withGlue = delegatedAddresses.map((entry) => ({
    ...entry,
    addresses: [...new Set([...entry.addresses, ...parentGlue.filter((glue) => glue.hostname === entry.hostname).map((glue) => glue.address)])],
  }));
  const childTargets = targetsFrom(withGlue);
  if (ipv6Connectivity === null && childTargets.some(isIpv6Target)) ipv6Connectivity = await detectIpv6Connectivity(options);
  const childObservations = await Promise.all(childTargets.filter(canQuery).map((target) => queryObservation(zone, target, options)));
  const childPublishedNameservers = unique(childObservations.flatMap((observation) => observation.nameservers));
  const allNameserverNames = unique([...parentDelegatedNameservers, ...childPublishedNameservers]);
  const allAddresses = await resolveNameserverAddresses(allNameserverNames, options);
  const nameserverAddresses = allAddresses.map((entry) => ({
    ...entry,
    addresses: [...new Set([...entry.addresses, ...parentGlue.filter((glue) => glue.hostname === entry.hostname).map((glue) => glue.address)])],
  }));
  const reachabilityTargets = targetsFrom(nameserverAddresses);
  if (ipv6Connectivity === null && reachabilityTargets.some(isIpv6Target)) ipv6Connectivity = await detectIpv6Connectivity(options);
  const reachability = await Promise.all(reachabilityTargets.map((target) =>
    isIpv6Target(target) && ipv6Connectivity === false
      ? skippedIpv6Reachability(target)
      : reachabilityCheck(zone, target, options)
  ));
  const authoritativeAddressObservations = await Promise.all(nameserverAddresses
    .filter((entry) => entry.hostname === zone || entry.hostname.endsWith(`.${zone}`))
    .flatMap((entry) => entry.addresses.filter((address) => isIP(address) !== 6 || ipv6Connectivity !== false).slice(0, 1).map((address) => authoritativeAddressObservation(entry.hostname, { hostname: entry.hostname, address }, options))));
  const addressDetails = await (options.addressEnrichment ?? enrichDnsAddresses)(
    nameserverAddresses.flatMap((entry) => entry.addresses),
    { signal: options.signal, timeoutMs: options.timeoutMs ?? 2500 },
  );
  const assessment = assessDelegation({ zone, parentDelegatedNameservers, childPublishedNameservers, parentGlue, nameserverAddresses, reachability, authoritativeAddressObservations, addressDetails, ipv6Connectivity });

  return {
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputName,
    zone,
    parentZone,
    ipv6Connectivity,
    parentNameservers,
    parentObservations,
    parentDelegatedNameservers,
    parentGlue,
    childPublishedNameservers,
    childObservations,
    nameserverAddresses,
    authoritativeAddressObservations,
    addressDetails,
    reachability,
    findings: assessment.findings,
    notes: assessment.notes,
  };
}

export type DnsSourceAnswer = {
  id: string;
  label: string;
  kind: "authoritative" | "resolver";
  server: DirectDnsTarget | null;
  responseCode: string | null;
  authoritative: boolean | null;
  authenticatedData: boolean | null;
  records: NormalizedDnsRecord[];
  error: string | null;
  rawResponse: RawDnsWireResponse | null;
};

function recordsFor(response: RawDnsWireResponse, type: DnsRecordType) {
  const requestedCode = recordTypeCode(type);
  return response.Answer.filter((record) => record.type === requestedCode || record.type === 5).map(normalizeWireRecord);
}

export async function checkDnsChange(
  request: { name: string; recordType: unknown; expectedAnswer?: string },
  options: DiagnosticOptions = {},
) {
  const startedAt = Date.now();
  const name = normalizeDiagnosticName(request.name);
  const recordType = normalizeChangeRecordType(request.recordType);
  const delegation = await checkDelegation(name, options);
  const directQuery = options.directQuery ?? queryDirectDnsServer;
  const discoveredAuthoritativeTargets = targetsFrom(delegation.nameserverAddresses);
  const skippedAuthoritativeTargets = delegation.ipv6Connectivity === false
    ? discoveredAuthoritativeTargets.filter(isIpv6Target)
    : [];
  const authoritativeTargets = discoveredAuthoritativeTargets
    .filter((target) => !isIpv6Target(target) || delegation.ipv6Connectivity !== false);
  const authoritative: DnsSourceAnswer[] = await Promise.all(authoritativeTargets.map(async (server, index) => {
    try {
      const response = await directQuery(name, recordType, server, { signal: options.signal, timeoutMs: options.timeoutMs ?? 2500 });
      return { id: `authority-${index}`, label: server.hostname, kind: "authoritative", server, responseCode: dnsResponseCode(response.Status), authoritative: response.AA, authenticatedData: null, records: recordsFor(response, recordType), error: null, rawResponse: response };
    } catch (error) {
      return { id: `authority-${index}`, label: server.hostname, kind: "authoritative", server, responseCode: null, authoritative: null, authenticatedData: null, records: [], error: safeDnsErrorMessage(error, "The nameserver did not answer."), rawResponse: null };
    }
  }));
  const publicProfiles = dnsResolverProfiles.filter((profile) => profile.kind === "public");
  const publicQuery = options.publicQuery ?? queryPublicResolver;
  const resolvers: DnsSourceAnswer[] = await Promise.all(publicProfiles.map(async (profile) => {
    try {
      const response = await publicQuery(name, recordType, profile.id as Exclude<DnsResolver, "authoritative">, { signal: options.signal });
      return { id: profile.id, label: resolverLabel(profile.id), kind: "resolver", server: null, responseCode: dnsResponseCode(response.Status), authoritative: null, authenticatedData: response.AD, records: recordsFor(response, recordType), error: null, rawResponse: response };
    } catch (error) {
      return { id: profile.id, label: resolverLabel(profile.id), kind: "resolver", server: null, responseCode: null, authoritative: null, authenticatedData: null, records: [], error: safeDnsErrorMessage(error, "The resolver did not answer."), rawResponse: null };
    }
  }));
  const expectedAnswer = request.expectedAnswer?.trim() || null;
  const normalizeValue = (value: string) => value.trim().replace(/\.$/, "").toLowerCase();
  const rrsetKey = (source: DnsSourceAnswer) => source.records.map((record) => `${record.ownerName}|${record.type}|${normalizeValue(record.value)}`).sort().join("\n");
  const successfulAuthority = authoritative.find((source) => source.responseCode === "NOERROR" && source.authoritative === true);
  const authorityKey = successfulAuthority ? rrsetKey(successfulAuthority) : null;
  const agreeingResolvers = authorityKey === null ? 0 : resolvers.filter((source) => source.responseCode === "NOERROR" && rrsetKey(source) === authorityKey).length;
  const respondingAuthority = authoritative.filter((source) => !source.error);
  return {
    query: { name, recordType, expectedAnswer },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    zone: delegation.zone,
    ipv6Connectivity: delegation.ipv6Connectivity,
    skippedAuthoritativeTargets,
    authoritative,
    resolvers,
    summary: {
      authoritativeServersAgree: respondingAuthority.length > 0 && new Set(respondingAuthority.map((source) => `${source.responseCode ?? "unknown"}|${rrsetKey(source)}`)).size <= 1,
      agreeingResolvers,
      totalResolvers: resolvers.length,
      expectedAnswerMatches: expectedAnswer === null ? null : [...authoritative, ...resolvers].filter((source) => source.records.some((record) => normalizeValue(record.value) === normalizeValue(expectedAnswer))).map((source) => source.id),
    },
  };
}

export async function checkSoaConsistency(nameInput: string, options: DiagnosticOptions = {}) {
  const startedAt = Date.now();
  const delegation = await checkDelegation(nameInput, options);
  const observations = delegation.reachability.map((result) => ({
    server: result.server,
    skippedReason: result.skippedReason,
    soa: result.soa,
    authoritative: result.udp.authoritative === true || result.tcp.authoritative === true,
    error: result.skippedReason ? null : result.soa ? null : result.udp.error ?? result.tcp.error ?? "No SOA record was returned.",
    rawResponses: result.rawResponses,
  }));
  const checkedObservations = observations.filter((observation) => !observation.skippedReason);
  const available = checkedObservations.filter((observation): observation is typeof observation & { soa: SoaRecord } => observation.soa !== null);
  const serials = [...new Set(available.map((observation) => observation.soa.serial))];
  let newestSerial: number | null = serials[0] ?? null;
  for (const serial of serials.slice(1)) {
    if (newestSerial !== null && compareSerials(serial, newestSerial) === "left-newer") newestSerial = serial;
  }
  const timingKeys = ["primaryNameserver", "responsibleMailbox", "refreshSeconds", "retrySeconds", "expireSeconds", "minimumSeconds"] as const;
  const differences = timingKeys.filter((key) => new Set(available.map((observation) => String(observation.soa[key]))).size > 1);
  return {
    query: { inputName: delegation.inputName, zone: delegation.zone },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ipv6Connectivity: delegation.ipv6Connectivity,
    observations,
    summary: {
      allAnswered: checkedObservations.length > 0 && checkedObservations.every((observation) => observation.soa !== null && observation.authoritative),
      serialsAgree: serials.length > 0 && serials.length <= 1,
      newestSerial,
      differences,
    },
  };
}

export type CaaRecord = {
  ownerName: string;
  flags: number;
  critical: boolean;
  tag: string;
  value: string;
  ttlSeconds: number | null;
  valid: boolean;
};

export function parseCaaRecord(record: RawDnsWireRecord): CaaRecord | null {
  if (record.type !== 257) return null;
  const match = record.data.match(/^(\d+)\s+([^\s]+)\s+"([\s\S]*)"$/);
  if (!match) return { ownerName: canonicalDnsName(record.name), flags: 0, critical: false, tag: "", value: record.data, ttlSeconds: record.TTL, valid: false };
  const flags = Number(match[1]);
  return {
    ownerName: canonicalDnsName(record.name),
    flags,
    critical: (flags & 128) === 128,
    tag: match[2].toLowerCase(),
    value: match[3],
    ttlSeconds: record.TTL,
    valid: Number.isInteger(flags) && flags >= 0 && flags <= 255,
  };
}

function parentDomain(name: string) {
  const labels = name.split(".");
  return labels.length > 1 ? labels.slice(1).join(".") : null;
}

export async function checkCaaPolicy(nameInput: string, options: DiagnosticOptions = {}) {
  const startedAt = Date.now();
  const inputName = normalizeDiagnosticName(nameInput);
  const publicQuery = options.publicQuery ?? queryPublicResolver;
  const levels: Array<{ name: string; searchReason: "requested" | "alias" | "parent"; responseCode: string | null; records: CaaRecord[]; aliasTarget: string | null; rawResponse: RawDnsWireResponse | null; error: string | null }> = [];
  const seen = new Set<string>();
  let treeName: string | null = inputName;
  let effectiveName: string | null = null;
  let records: CaaRecord[] = [];
  let error: string | null = null;
  let depth = 0;
  while (treeName && depth < 24 && !records.length && !error) {
    let current: string | null = treeName;
    let reason: "requested" | "alias" | "parent" = treeName === inputName ? "requested" : "parent";
    while (current && depth < 24) {
      depth += 1;
      if (seen.has(current)) { error = "The CAA search found an alias or parent loop."; break; }
      seen.add(current);
      try {
        const response = await publicQuery(current, "CAA", "cloudflare", { signal: options.signal });
        const parsed = response.Answer.map(parseCaaRecord).filter((record): record is CaaRecord => record !== null);
        const cname = response.Answer.find((record) => record.type === 5);
        const aliasTarget = cname ? canonicalDnsName(cname.data) : null;
        levels.push({ name: current, searchReason: reason, responseCode: dnsResponseCode(response.Status), records: parsed, aliasTarget, rawResponse: response, error: null });
        if (response.Status !== 0) { error = `The lookup returned ${dnsResponseCode(response.Status)}, so the effective CAA policy could not be determined.`; break; }
        if (parsed.length) { records = parsed; effectiveName = parsed[0].ownerName || current; break; }
        if (!aliasTarget) break;
        current = aliasTarget;
        reason = "alias";
      } catch (caught) {
        error = safeDnsErrorMessage(caught, "The CAA lookup failed.");
        levels.push({ name: current ?? treeName, searchReason: reason, responseCode: null, records: [], aliasTarget: null, rawResponse: null, error });
        break;
      }
    }
    if (!records.length && !error) treeName = parentDomain(treeName);
  }
  if (depth >= 24 && !records.length && !error) error = "The CAA search exceeded the safe alias and parent depth.";
  if (!effectiveName && !error) effectiveName = null;
  const issue = records.filter((record) => record.tag === "issue");
  const issuewild = records.filter((record) => record.tag === "issuewild");
  const iodef = records.filter((record) => record.tag === "iodef");
  const knownTags = new Set(["issue", "issuewild", "iodef"]);
  const unknown = records.filter((record) => !knownTags.has(record.tag));
  const normalPolicy = issue.length ? issue : [];
  const wildcardPolicy = issuewild.length ? issuewild : issue;
  const issuer = (record: CaaRecord) => record.value.split(";")[0].trim().toLowerCase();
  const describe = (policy: CaaRecord[], unrestrictedWhenEmpty: boolean) => {
    if (!policy.length) return { unrestricted: unrestrictedWhenEmpty, denied: false, issuers: [] as string[] };
    const issuers = [...new Set(policy.map(issuer).filter(Boolean))];
    return { unrestricted: false, denied: issuers.length === 0, issuers };
  };
  return {
    query: { inputName },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status: error ? "undetermined" : records.length ? "policy_found" : "no_policy",
    effectiveName,
    levels,
    records,
    normal: describe(normalPolicy, issue.length === 0),
    wildcard: describe(wildcardPolicy, issuewild.length === 0 && issue.length === 0),
    usesIssueForWildcard: issuewild.length === 0 && issue.length > 0,
    iodef: iodef.map((record) => ({ value: record.value, validUrl: /^(mailto:|https?:\/\/)/i.test(record.value) })),
    unknownCriticalTags: unknown.filter((record) => record.critical).map((record) => record.tag || "malformed tag"),
    malformedRecords: records.filter((record) => !record.valid).length,
    error,
  };
}
