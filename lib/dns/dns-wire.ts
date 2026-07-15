import dnsPacket, { type Answer, type Packet, type RecordType } from "dns-packet";
import { recordTypeCode } from "./record-types.ts";
import type { DnsRecordType } from "./types.ts";

export type RawDnsWireRecord = { name: string; type: number | null; TTL: number | null; data: string };

export type RawDnsWireResponse = {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  AA: boolean;
  Question: Array<{ name: string; type: number | null }>;
  Answer: RawDnsWireRecord[];
  Authority: RawDnsWireRecord[];
  Additional: RawDnsWireRecord[];
  Comment?: string[];
};

const rcodeNumbers: Record<string, number> = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
};

function quote(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function bufferText(value: string | Buffer) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function recordData(record: Answer): string {
  const answer = record as Answer & { data?: unknown };
  const data = answer.data;
  switch (record.type) {
    case "A":
    case "AAAA":
    case "CNAME":
    case "DNAME":
    case "NS":
    case "PTR":
      return typeof data === "string" ? data : "";
    case "MX": {
      const value = data as { preference?: number; exchange?: string };
      return `${value?.preference ?? 0} ${value?.exchange ?? ""}`.trim();
    }
    case "TXT": {
      const parts = (Array.isArray(data) ? data : [data])
        .filter((part): part is string | Buffer => typeof part === "string" || Buffer.isBuffer(part))
        .map(bufferText);
      return quote(parts.join(""));
    }
    case "CAA": {
      const value = data as { flags?: number; issuerCritical?: boolean; tag?: string; value?: string };
      const flags = value?.flags ?? (value?.issuerCritical ? 128 : 0);
      return `${flags} ${value?.tag ?? ""} ${quote(value?.value ?? "")}`.trim();
    }
    case "SOA": {
      const value = data as { mname?: string; rname?: string; serial?: number; refresh?: number; retry?: number; expire?: number; minimum?: number };
      return [value?.mname, value?.rname, value?.serial, value?.refresh, value?.retry, value?.expire, value?.minimum]
        .map((part) => part ?? 0)
        .join(" ");
    }
    case "SRV": {
      const value = data as { priority?: number; weight?: number; port?: number; target?: string };
      return `${value?.priority ?? 0} ${value?.weight ?? 0} ${value?.port ?? 0} ${value?.target ?? ""}`.trim();
    }
    case "DS": {
      const value = data as { keyTag?: number; algorithm?: number; digestType?: number; digest?: Buffer };
      return `${value?.keyTag ?? 0} ${value?.algorithm ?? 0} ${value?.digestType ?? 0} ${value?.digest?.toString("hex").toUpperCase() ?? ""}`.trim();
    }
    case "DNSKEY": {
      const value = data as { flags?: number; algorithm?: number; key?: Buffer };
      return `${value?.flags ?? 0} 3 ${value?.algorithm ?? 0} ${value?.key?.toString("base64") ?? ""}`.trim();
    }
    default:
      if (typeof data === "string") return data;
      if (Buffer.isBuffer(data)) return `\\# ${data.length} ${data.toString("hex").toUpperCase()}`;
      return data === undefined ? "" : JSON.stringify(data);
  }
}

function rawRecord(record: Answer): RawDnsWireRecord | null {
  if (record.type === "OPT") return null;
  const data = recordData(record);
  if (!data) return null;
  return {
    name: record.name,
    type: recordTypeCode(record.type),
    TTL: "ttl" in record && typeof record.ttl === "number" ? record.ttl : null,
    data,
  };
}

function rawRecords(records: Answer[] | undefined) {
  return (records ?? []).map(rawRecord).filter((record): record is RawDnsWireRecord => record !== null);
}

export function encodeDnsQuery(
  name: string,
  type: DnsRecordType | "NS",
  options: { recursive?: boolean; id?: number } = {},
) {
  const packet: Packet = {
    type: "query",
    id: options.id ?? Math.floor(Math.random() * 65_536),
    flags: options.recursive === false ? 0 : dnsPacket.RECURSION_DESIRED,
    questions: [{ name, type: type as RecordType, class: "IN" }],
    answers: [],
    authorities: [],
    additionals: [],
  };
  return dnsPacket.encode(packet);
}

export function decodeDnsResponse(packet: Uint8Array, comments?: string[]): RawDnsWireResponse {
  const decoded = dnsPacket.decode(Buffer.from(packet)) as ReturnType<typeof dnsPacket.decode> & { rcode?: string };
  if (decoded.type !== "response") throw new Error("The DNS server did not return a response packet.");
  const result: RawDnsWireResponse = {
    Status: rcodeNumbers[decoded.rcode ?? "NOERROR"] ?? (decoded.flags ?? 0) & 15,
    TC: decoded.flag_tc,
    RD: decoded.flag_rd,
    RA: decoded.flag_ra,
    AD: decoded.flag_ad,
    CD: decoded.flag_cd,
    AA: decoded.flag_aa,
    Question: (decoded.questions ?? []).map((question) => ({
      name: question.name,
      type: recordTypeCode(question.type),
    })),
    Answer: rawRecords(decoded.answers),
    Authority: rawRecords(decoded.authorities),
    Additional: rawRecords(decoded.additionals),
  };
  if (comments?.length) result.Comment = comments;
  return result;
}
