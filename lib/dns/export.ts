type CsvRecord = {
  ownerName: string;
  value: string;
  resolverTtlSeconds: number | null;
};

type CsvQueryResult = {
  requestedType: string;
  terminalRecords: CsvRecord[];
};

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function dnsRecordsCsv({
  authoritative,
  queryResults,
  resolverLabel,
}: {
  authoritative: boolean;
  queryResults: CsvQueryResult[];
  resolverLabel: string;
}) {
  const rows: Array<Array<string | number | null>> = [
    ["requested_type", "owner_name", "value", "ttl_kind", "ttl_seconds", "resolver"],
  ];
  for (const result of queryResults) {
    for (const record of result.terminalRecords) {
      rows.push([
        result.requestedType,
        record.ownerName,
        record.value,
        authoritative ? "authoritative_published" : "resolver_remaining",
        record.resolverTtlSeconds,
        resolverLabel,
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
