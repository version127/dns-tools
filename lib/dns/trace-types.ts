import type { NormalizedDnsRecord } from "./types.ts";

export const TRACE_RECORD_TYPES = [
  "A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY",
] as const;

export type DnsTraceRecordType = (typeof TRACE_RECORD_TYPES)[number];

export type DnsTraceServer = {
  hostname: string;
  address: string;
};

export type DnsTraceAttempt = {
  server: DnsTraceServer;
  durationMs: number;
  error: string;
};

export type DnsTraceStep = {
  sequence: number;
  stage: "root" | "tld" | "authoritative";
  zone: string;
  server: DnsTraceServer | null;
  questionName: string;
  requestedType: DnsTraceRecordType;
  responseCode: string | null;
  authoritative: boolean | null;
  durationMs: number | null;
  outcome: "referral" | "answer" | "alias" | "no_answer" | "nxdomain" | "error";
  message: string;
  delegatedZone: string | null;
  nameservers: string[];
  glueRecords: NormalizedDnsRecord[];
  additionalAddressRecords: NormalizedDnsRecord[];
  answerRecords: NormalizedDnsRecord[];
  aliasTarget: string | null;
  attempts: DnsTraceAttempt[];
  rawResponse: unknown;
};

export type DnsTraceResponse = {
  query: {
    originalInput: string;
    normalizedName: string;
    recordType: DnsTraceRecordType;
  };
  checkedAt: string;
  durationMs: number;
  outcome: "found" | "no_answer" | "nxdomain" | "error";
  finalName: string;
  finalRecords: NormalizedDnsRecord[];
  steps: DnsTraceStep[];
  warnings: string[];
};
