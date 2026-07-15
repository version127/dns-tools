import type { DnsResolver } from "./types.ts";
import { dnsResolvers } from "./types.ts";

export type DnsResolverProfile = {
  id: DnsResolver;
  label: string;
  endpoint: string | null;
  kind: "public" | "authoritative";
  policy: string;
  transport?: "fetch" | "http2";
};

export const dnsResolverProfiles: readonly DnsResolverProfile[] = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    endpoint: "https://cloudflare-dns.com/dns-query",
    kind: "public",
    policy: "Uses Cloudflare's public recursive resolver.",
  },
  {
    id: "google",
    label: "Google Public DNS",
    endpoint: "https://dns.google/dns-query",
    kind: "public",
    policy: "Uses Google Public DNS.",
  },
  {
    id: "quad9",
    label: "Quad9",
    endpoint: "https://dns10.quad9.net/dns-query",
    kind: "public",
    policy: "Uses Quad9's unfiltered service, without threat blocking.",
    transport: "http2",
  },
  {
    id: "opendns",
    label: "OpenDNS",
    endpoint: "https://doh.opendns.com/dns-query",
    kind: "public",
    policy: "Uses the standard OpenDNS public service.",
  },
  {
    id: "adguard",
    label: "AdGuard DNS",
    endpoint: "https://unfiltered.adguard-dns.com/dns-query",
    kind: "public",
    policy: "Uses AdGuard DNS without content filtering.",
  },
  {
    id: "controld",
    label: "Control D",
    endpoint: "https://freedns.controld.com/p0",
    kind: "public",
    policy: "Uses Control D without content filtering.",
  },
  {
    id: "yandex",
    label: "Yandex DNS",
    endpoint: "https://common.dot.dns.yandex.net/dns-query",
    kind: "public",
    policy: "Uses Yandex's basic service without family or threat filtering.",
    transport: "http2",
  },
  {
    id: "authoritative",
    label: "Authoritative nameserver",
    endpoint: null,
    kind: "authoritative",
    policy: "Queries a nameserver that hosts the domain instead of a public resolver cache.",
  },
];

const profilesById = new Map(dnsResolverProfiles.map((profile) => [profile.id, profile]));

export function isDnsResolver(value: unknown): value is DnsResolver {
  return typeof value === "string" && dnsResolvers.includes(value as DnsResolver);
}

export function resolverProfile(resolver: DnsResolver) {
  const profile = profilesById.get(resolver);
  if (!profile) throw new Error("Choose a supported DNS source.");
  return profile;
}

export function resolverLabel(resolver: DnsResolver) {
  return resolverProfile(resolver).label;
}
