const responseCodes = new Map<number, string>([
  [0, "NOERROR"],
  [1, "FORMERR"],
  [2, "SERVFAIL"],
  [3, "NXDOMAIN"],
  [4, "NOTIMP"],
  [5, "REFUSED"],
]);

export function responseCodeName(code: number | null) {
  if (code === null) return null;
  return responseCodes.get(code) ?? `RCODE${code}`;
}
