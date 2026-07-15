export const DNSSEC_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV"] as const;
export type DnssecRecordType = (typeof DNSSEC_RECORD_TYPES)[number];
export type DnssecVerdict = "secure" | "insecure" | "bogus" | "indeterminate";

export type DnssecSignature = {
  ownerName: string;
  queryName: string;
  queryType: string;
  typeCovered: string;
  algorithm: number;
  algorithmName: string;
  keyTag: number;
  signerName: string;
  inception: string;
  expiration: string;
  status: "valid" | "expired" | "not-yet-valid";
  secondsRemaining: number;
};
