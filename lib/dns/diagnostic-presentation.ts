import type { DnsSourceAnswer, SoaRecord } from "./diagnostic-types.ts";

type SoaObservation = {
  server: { hostname: string; address: string };
  soa: SoaRecord | null;
  authoritative: boolean;
  error: string | null;
  rawResponses: unknown;
};

function normalizedRecordSet(source: DnsSourceAnswer) {
  return source.records
    .map((record) => `${record.ownerName}|${record.type}|${record.value.trim().replace(/\.$/, "").toLowerCase()}`)
    .sort()
    .join("\n");
}

export function groupDnsSources(sources: DnsSourceAnswer[]) {
  const groups = new Map<string, { key: string; records: DnsSourceAnswer["records"]; responseCode: string | null; error: string | null; sources: DnsSourceAnswer[] }>();
  for (const source of sources) {
    const key = source.error
      ? `error|${source.error}`
      : `${source.responseCode ?? "unknown"}|${normalizedRecordSet(source)}`;
    const group = groups.get(key);
    if (group) group.sources.push(source);
    else groups.set(key, { key, records: source.records, responseCode: source.responseCode, error: source.error, sources: [source] });
  }
  return [...groups.values()];
}

function soaKey(observation: SoaObservation) {
  if (!observation.soa) return `error|${observation.server.hostname}|${observation.error}`;
  const soa = observation.soa;
  return [
    observation.server.hostname,
    observation.authoritative,
    soa.ownerName,
    soa.primaryNameserver,
    soa.responsibleMailbox,
    soa.serial,
    soa.refreshSeconds,
    soa.retrySeconds,
    soa.expireSeconds,
    soa.minimumSeconds,
    soa.ttlSeconds,
  ].join("|");
}

export function groupSoaObservations(observations: SoaObservation[]) {
  const groups = new Map<string, {
    hostname: string;
    addresses: string[];
    soa: SoaRecord | null;
    authoritative: boolean;
    error: string | null;
    observations: SoaObservation[];
  }>();
  for (const observation of observations) {
    const key = soaKey(observation);
    const group = groups.get(key);
    if (group) {
      group.addresses.push(observation.server.address);
      group.observations.push(observation);
    } else {
      groups.set(key, {
        hostname: observation.server.hostname,
        addresses: [observation.server.address],
        soa: observation.soa,
        authoritative: observation.authoritative,
        error: observation.error,
        observations: [observation],
      });
    }
  }
  return [...groups.values()];
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvFromRows(rows: unknown[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function negativeCacheTtlSeconds(soa: Pick<SoaRecord, "ttlSeconds" | "minimumSeconds">) {
  return soa.ttlSeconds === null ? null : Math.min(soa.ttlSeconds, soa.minimumSeconds);
}
