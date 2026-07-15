const namesByCode = new Map<number, string>([
  [1, "A"],
  [2, "NS"],
  [5, "CNAME"],
  [6, "SOA"],
  [12, "PTR"],
  [15, "MX"],
  [16, "TXT"],
  [28, "AAAA"],
  [33, "SRV"],
  [43, "DS"],
  [46, "RRSIG"],
  [47, "NSEC"],
  [48, "DNSKEY"],
  [50, "NSEC3"],
  [64, "SVCB"],
  [65, "HTTPS"],
  [257, "CAA"],
]);

const codesByName = new Map([...namesByCode.entries()].map(([code, name]) => [name, code]));

export function recordTypeName(typeCode: number | null) {
  if (typeCode === null) return "UNKNOWN";
  return namesByCode.get(typeCode) ?? `TYPE${typeCode}`;
}

export function recordTypeCode(typeName: string) {
  return codesByName.get(typeName.toUpperCase()) ?? null;
}
