import { canonicalDnsName } from "./normalize-name.ts";
import type { NormalizedDnsRecord } from "./types.ts";

export type RecordField = {
  label: string;
  value: string;
};

function unquoteTxt(value: string) {
  const parts = [...value.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]);
  return parts.length > 0 ? parts.join("") : value;
}

function decodeCaaWireValue(value: string) {
  const match = value.match(/^\\#\s+\d+\s+((?:[0-9a-f]{2}(?:\s+|$))+)/i);
  if (!match) return null;
  const bytes = Uint8Array.from(match[1].trim().split(/\s+/).map((part) => Number.parseInt(part, 16)));
  if (bytes.length < 2) return null;
  const tagLength = bytes[1];
  if (2 + tagLength > bytes.length) return null;
  const decoder = new TextDecoder();
  return {
    flags: String(bytes[0]),
    property: decoder.decode(bytes.slice(2, 2 + tagLength)),
    value: decoder.decode(bytes.slice(2 + tagLength)),
  };
}

export function recordFields(record: NormalizedDnsRecord): RecordField[] {
  const parts = record.value.trim().split(/\s+/);
  if (record.type === "MX" && parts.length >= 2) {
    return [
      { label: "Priority", value: parts[0] },
      { label: "Mail exchanger", value: canonicalDnsName(parts.slice(1).join(" ")) },
    ];
  }
  if (record.type === "SOA" && parts.length >= 7) {
    const labels = ["Primary server", "Responsible mailbox", "Serial", "Refresh", "Retry", "Expire", "Negative cache field"];
    return labels.map((label, index) => ({
      label,
      value: index < 2 ? canonicalDnsName(parts[index]) : parts[index],
    }));
  }
  if (record.type === "SRV" && parts.length >= 4) {
    return [
      { label: "Priority", value: parts[0] },
      { label: "Weight", value: parts[1] },
      { label: "Port", value: parts[2] },
      { label: "Target", value: canonicalDnsName(parts.slice(3).join(" ")) },
    ];
  }
  if (record.type === "CAA" && parts.length >= 3) {
    const decoded = decodeCaaWireValue(record.value);
    if (decoded) {
      return [
        { label: "Flags", value: decoded.flags },
        { label: "Property", value: decoded.property },
        { label: "Value", value: decoded.value },
      ];
    }
    return [
      { label: "Flags", value: parts[0] },
      { label: "Property", value: parts[1] },
      { label: "Value", value: parts.slice(2).join(" ").replace(/^"|"$/g, "") },
    ];
  }
  if (record.type === "DS" && parts.length >= 4) {
    return [
      { label: "Key tag", value: parts[0] },
      { label: "Algorithm", value: parts[1] },
      { label: "Digest type", value: parts[2] },
      { label: "Digest", value: parts.slice(3).join("") },
    ];
  }
  if (record.type === "DNSKEY" && parts.length >= 4) {
    return [
      { label: "Flags", value: parts[0] },
      { label: "Protocol", value: parts[1] },
      { label: "Algorithm", value: parts[2] },
      { label: "Public key", value: parts.slice(3).join("") },
    ];
  }
  if (record.type === "TXT") return [{ label: "Text", value: unquoteTxt(record.value) }];
  if (record.type === "CNAME") return [{ label: "Alias target", value: canonicalDnsName(record.value) }];
  if (record.type === "NS") return [{ label: "Nameserver", value: canonicalDnsName(record.value) }];
  if (record.type === "PTR") return [{ label: "Hostname", value: canonicalDnsName(record.value) }];
  if (record.type === "A") return [{ label: "IPv4 address", value: record.value }];
  if (record.type === "AAAA") return [{ label: "IPv6 address", value: record.value }];
  return [{ label: "Value", value: record.value }];
}

export function formatResolverTtl(value: number | null) {
  if (value === null) return "Not reported";
  const seconds = `${value.toLocaleString("en-US")} ${value === 1 ? "second" : "seconds"}`;
  if (value < 60) return `${seconds} remaining`;
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${seconds}, about ${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
  const hours = Math.max(1, Math.round(value / 3600));
  if (hours < 48) return `${seconds}, about ${hours} ${hours === 1 ? "hour" : "hours"} remaining`;
  const days = Math.max(1, Math.round(value / 86400));
  return `${seconds}, about ${days} ${days === 1 ? "day" : "days"} remaining`;
}

export function formatAuthoritativeTtl(value: number | null) {
  if (value === null) return "Not reported";
  const seconds = `${value.toLocaleString("en-US")} ${value === 1 ? "second" : "seconds"}`;
  if (value < 60) return seconds;
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${seconds}, about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.max(1, Math.round(value / 3600));
  if (hours < 48) return `${seconds}, about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.max(1, Math.round(value / 86400));
  return `${seconds}, about ${days} ${days === 1 ? "day" : "days"}`;
}
