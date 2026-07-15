import { domainToASCII } from "node:url";

export type NormalizedDnsInput = {
  originalInput: string;
  normalizedName: string;
  inputKind: "name" | "ip";
};

function normalizeIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return null;
  return numbers.join(".");
}

function ipv6Hextets(value: string) {
  let candidate = value.toLowerCase();
  if (candidate.startsWith("[") && candidate.endsWith("]")) candidate = candidate.slice(1, -1);
  if (!candidate || candidate.includes("%") || (candidate.match(/::/g)?.length ?? 0) > 1) return null;

  const ipv4Tail = candidate.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail) {
    const ipv4 = normalizeIpv4(ipv4Tail);
    if (!ipv4) return null;
    const octets = ipv4.split(".").map(Number);
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    candidate = `${candidate.slice(0, -ipv4Tail.length)}${replacement}`;
  }

  const hasCompression = candidate.includes("::");
  const [leftText, rightText = ""] = candidate.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const valid = [...left, ...right].every((part) => /^[0-9a-f]{1,4}$/.test(part));
  if (!valid) return null;
  if ((!hasCompression && left.length !== 8) || (hasCompression && left.length + right.length >= 8)) return null;
  const zeros = hasCompression ? Array(8 - left.length - right.length).fill("0") : [];
  const parts = [...left, ...zeros, ...right];
  return parts.length === 8 ? parts.map((part) => part.padStart(4, "0")) : null;
}

function compressIpv6(parts: string[]) {
  const short = parts.map((part) => Number.parseInt(part, 16).toString(16));
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < short.length;) {
    if (short[start] !== "0") {
      start += 1;
      continue;
    }
    let end = start;
    while (end < short.length && short[end] === "0") end += 1;
    if (end - start > bestLength && end - start > 1) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestStart < 0) return short.join(":");
  const left = short.slice(0, bestStart).join(":");
  const right = short.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

export function normalizeIpAddress(value: string) {
  const ipv4 = normalizeIpv4(value.trim());
  if (ipv4) return ipv4;
  const ipv6 = ipv6Hextets(value.trim());
  return ipv6 ? compressIpv6(ipv6) : null;
}

export function reverseDnsName(value: string) {
  const ipv4 = normalizeIpv4(value.trim());
  if (ipv4) return `${ipv4.split(".").reverse().join(".")}.in-addr.arpa`;
  const ipv6 = ipv6Hextets(value.trim());
  if (ipv6) return `${ipv6.join("").split("").reverse().join(".")}.ip6.arpa`;
  throw new Error("Enter a valid IPv4 or IPv6 address for a PTR lookup.");
}

function hostnameFromUrl(input: string) {
  if (!/^https?:\/\//i.test(input)) return null;

  const url = new URL(input);
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not accepted.");
  }
  return url.hostname;
}

function validateLabels(name: string) {
  if (!name || name.length > 253) {
    throw new Error("Enter a DNS name no longer than 253 characters.");
  }

  const labels = name.split(".");
  for (const label of labels) {
    if (!label || label.length > 63) {
      throw new Error("Each DNS label must contain 1 to 63 characters.");
    }
    if (!/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i.test(label)) {
      throw new Error("Enter a valid DNS name or HTTP/HTTPS URL.");
    }
  }
}

export function normalizeDnsInput(input: string): NormalizedDnsInput {
  const originalInput = String(input ?? "").trim();
  if (!originalInput) throw new Error("Enter a DNS name.");
  if (/[\u0000-\u001f\u007f]/.test(originalInput)) {
    throw new Error("The DNS name contains unsupported control characters.");
  }

  let candidate: string;
  try {
    candidate = hostnameFromUrl(originalInput) ?? originalInput;
  } catch (error) {
    if (error instanceof Error && error.message.includes("credentials")) throw error;
    throw new Error("Enter a valid DNS name or HTTP/HTTPS URL.");
  }

  candidate = candidate.replace(/\.$/, "").toLowerCase();
  const normalizedIp = normalizeIpAddress(candidate);
  if (normalizedIp) return { originalInput, normalizedName: normalizedIp, inputKind: "ip" };
  if (candidate.includes(":") && !candidate.includes("::")) {
    throw new Error("Enter a valid DNS name or HTTP/HTTPS URL.");
  }

  const ascii = domainToASCII(candidate);
  if (!ascii) throw new Error("Enter a valid DNS name or HTTP/HTTPS URL.");
  validateLabels(ascii);

  return { originalInput, normalizedName: ascii.toLowerCase(), inputKind: "name" };
}

export function canonicalDnsName(value: string) {
  return value.trim().replace(/\.$/, "").toLowerCase();
}
