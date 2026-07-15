import { isPublicDnsAddress } from "./authoritative.ts";
import { queryPublicResolver } from "./doh.ts";
import { canonicalDnsName, reverseDnsName } from "./normalize-name.ts";
import type { DnsAddressDetail, DnsNameserverAddress, DnsQueryResult } from "./types.ts";

const MAX_NAMESERVERS = 8;
const MAX_ADDRESSES = 16;

function unquoteTxt(value: string) {
  const parts = [...value.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]);
  return (parts.length > 0 ? parts.join("") : value).replaceAll('\\"', '"').trim();
}

function firstTxt(response: Awaited<ReturnType<typeof queryPublicResolver>>) {
  const value = response.Answer.find((record) => record.type === 16)?.data;
  return value ? unquoteTxt(value) : null;
}

export function addressToCymruName(address: string) {
  const reverse = reverseDnsName(address);
  if (reverse.endsWith(".in-addr.arpa")) {
    return `${reverse.slice(0, -".in-addr.arpa".length)}.origin.asn.cymru.com`;
  }
  return `${reverse.slice(0, -".ip6.arpa".length)}.origin6.asn.cymru.com`;
}

export function parseCymruOrigin(value: string) {
  const [asnText, prefix, countryCode] = unquoteTxt(value).split("|").map((part) => part.trim());
  const firstAsn = Number.parseInt(asnText?.split(/[\u0000\s]+/)[0] ?? "", 10);
  if (!Number.isInteger(firstAsn) || firstAsn <= 0) return null;
  return {
    asn: firstAsn,
    prefix: prefix || null,
    countryCode: countryCode || null,
  };
}

export function parseCymruAsnName(value: string) {
  const parts = unquoteTxt(value).split("|").map((part) => part.trim());
  return parts[4] || null;
}

export async function enrichDnsAddresses(
  values: string[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DnsAddressDetail[]> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  const queryOptions = { fetchImpl: options.fetchImpl, signal: controller.signal };

  try {
    const addresses = unique(values.filter(isPublicDnsAddress)).slice(0, MAX_ADDRESSES);
    const origins = await Promise.all(addresses.map(async (address) => {
      const response = await safeQuery(addressToCymruName(address), "TXT", queryOptions);
      const parsed = response ? parseCymruOrigin(firstTxt(response) ?? "") : null;
      return { address, parsed };
    }));
    const asns = unique(origins.flatMap((entry) => entry.parsed ? [entry.parsed.asn] : []));
    const asnNames = new Map<number, string | null>(await Promise.all(asns.map(async (asn) => {
      const response = await safeQuery(`AS${asn}.asn.cymru.com`, "TXT", queryOptions);
      return [asn, response ? parseCymruAsnName(firstTxt(response) ?? "") : null] as const;
    })));

    return origins.map(({ address, parsed }) => ({
      address,
      asn: parsed?.asn ?? null,
      networkName: parsed ? asnNames.get(parsed.asn) ?? null : null,
      prefix: parsed?.prefix ?? null,
      countryCode: parsed?.countryCode ?? null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

async function safeQuery(
  name: string,
  type: "A" | "AAAA" | "TXT",
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal },
) {
  try {
    return await queryPublicResolver(name, type, "cloudflare", options);
  } catch {
    return null;
  }
}

export async function enrichDnsResults(
  queryResults: DnsQueryResult[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ addressDetails: DnsAddressDetail[]; nameserverAddresses: DnsNameserverAddress[] }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  const queryOptions = { fetchImpl: options.fetchImpl, signal: controller.signal };

  try {
    const nameservers = unique(queryResults.flatMap((result) => result.terminalRecords)
      .filter((record) => record.type === "NS")
      .map((record) => canonicalDnsName(record.value)))
      .slice(0, MAX_NAMESERVERS);

    const nameserverAddresses = await Promise.all(nameservers.map(async (nameserver) => {
      const responses = await Promise.all([
        safeQuery(nameserver, "A", queryOptions),
        safeQuery(nameserver, "AAAA", queryOptions),
      ]);
      const addresses = unique(responses.flatMap((response) => response?.Answer ?? [])
        .filter((record) => record.type === 1 || record.type === 28)
        .map((record) => record.data)
        .filter(isPublicDnsAddress));
      return { nameserver, addresses };
    }));

    const answerAddresses = queryResults.flatMap((result) => result.terminalRecords)
      .filter((record) => record.type === "A" || record.type === "AAAA")
      .map((record) => record.value)
      .filter(isPublicDnsAddress);
    const addresses = unique([
      ...answerAddresses,
      ...nameserverAddresses.flatMap((entry) => entry.addresses),
    ]).slice(0, MAX_ADDRESSES);

    const addressDetails = await enrichDnsAddresses(addresses, options);
    return {
      addressDetails,
      nameserverAddresses: nameserverAddresses.filter((entry) => entry.addresses.length > 0),
    };
  } catch {
    return { addressDetails: [], nameserverAddresses: [] };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
