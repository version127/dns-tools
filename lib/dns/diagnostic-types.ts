import type { RawDnsWireResponse } from "./dns-wire.ts";
import type { DnsAddressDetail, NormalizedDnsRecord } from "./types.ts";

export const CHANGE_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY"] as const;
export type ChangeRecordType = (typeof CHANGE_RECORD_TYPES)[number];

export type NameserverAddress = { hostname: string; addresses: string[] };

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

export type DelegationObservation = {
  server: { hostname: string; address: string };
  responseCode: string | null;
  authoritative: boolean | null;
  nameservers: string[];
  glue: Array<{ hostname: string; address: string; ttlSeconds: number | null }>;
  error: string | null;
  rawResponse: RawDnsWireResponse | null;
};

export type NameserverReachability = {
  server: { hostname: string; address: string };
  udp: { reachable: boolean; authoritative: boolean | null; responseCode: string | null; error: string | null };
  tcp: { reachable: boolean; authoritative: boolean | null; responseCode: string | null; error: string | null };
  soa: SoaRecord | null;
  rawResponses: { udp: RawDnsWireResponse | null; tcp: RawDnsWireResponse | null };
};

export type NameserverAddressObservation = {
  hostname: string;
  server: { hostname: string; address: string };
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

export type DnsSourceAnswer = {
  id: string;
  label: string;
  kind: "authoritative" | "resolver";
  server: { hostname: string; address: string } | null;
  responseCode: string | null;
  authoritative: boolean | null;
  authenticatedData: boolean | null;
  records: NormalizedDnsRecord[];
  error: string | null;
  rawResponse: RawDnsWireResponse | null;
};

export type CaaRecord = {
  ownerName: string;
  flags: number;
  critical: boolean;
  tag: string;
  value: string;
  ttlSeconds: number | null;
  valid: boolean;
};
