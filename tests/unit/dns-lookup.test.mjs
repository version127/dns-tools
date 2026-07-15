import assert from "node:assert/strict";
import test from "node:test";
import dnsPacket from "dns-packet";

import {
  buildUnifiedAliasChain,
  normalizeAliasEdges,
} from "../../lib/dns/alias-chain.ts";
import { normalizeDnsInput, reverseDnsName } from "../../lib/dns/normalize-name.ts";
import {
  normalizeProviderResponse,
  nullableBoolean,
} from "../../lib/dns/normalize-provider-response.ts";
import {
  ALL_RECORD_TYPES,
  lookupDns,
  normalizeSelection,
} from "../../lib/dns/lookup.ts";
import {
  clearDnsLookupLimitsForTests,
  consumeDnsLookupLimit,
  rateLimitCost,
} from "../../lib/dns/rate-limit.ts";
import { formatAuthoritativeTtl, formatResolverTtl, recordFields } from "../../lib/dns/format-record.ts";
import { websiteFaviconUrl } from "../../lib/dns/favicon.ts";
import { dnsRecordsCsv } from "../../lib/dns/export.ts";
import {
  addressToCymruName,
  enrichDnsResults,
  parseCymruAsnName,
  parseCymruOrigin,
} from "../../lib/dns/network-enrichment.ts";
import { caaPropertyCounts, traceLinkForLookup } from "../../lib/dns/result-presentation.ts";

function wireResponse(queryBody, answers = [], flags = dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | dnsPacket.AUTHENTIC_DATA) {
  const query = dnsPacket.decode(Buffer.from(queryBody));
  const body = dnsPacket.encode({
    type: "response",
    id: query.id,
    flags,
    questions: query.questions,
    answers,
    authorities: [],
    additionals: [],
  });
  return new Response(body, { headers: { "content-type": "application/dns-message" } });
}

test("normalizes domains, URLs, trailing dots, service names, and Unicode", () => {
  assert.equal(normalizeDnsInput(" Example.COM. ").normalizedName, "example.com");
  assert.equal(normalizeDnsInput("https://www.example.com/path").normalizedName, "www.example.com");
  assert.equal(normalizeDnsInput("_sip._tcp.example.com").normalizedName, "_sip._tcp.example.com");
  assert.equal(normalizeDnsInput("https://münich.example/path").normalizedName, "xn--mnich-kva.example");
  assert.throws(() => normalizeDnsInput("example.com:8080"), /valid DNS name or HTTP/);
  assert.throws(() => normalizeDnsInput("https://user:pass@example.com"), /credentials/);
});

test("builds website favicon URLs without requesting icons for service or local names", () => {
  assert.equal(websiteFaviconUrl("www.Example.com."), "https://www.example.com/favicon.ico");
  assert.equal(websiteFaviconUrl("_dmarc.example.com"), null);
  assert.equal(websiteFaviconUrl("_sip._tcp.example.com"), null);
  assert.equal(websiteFaviconUrl("localhost"), null);
  assert.equal(websiteFaviconUrl("1.1.1.1"), null);
  assert.equal(websiteFaviconUrl("2606:4700:4700::1111"), null);
});

test("offers one trace link for SERVFAIL or NXDOMAIN but not ordinary empty answers or PTR", () => {
  const result = (outcome, responseCode, requestedType = "A") => ({
    query: { normalizedName: "www.example.com", selection: requestedType },
    queryResults: [{ outcome, requestedType, responseCode }],
  });

  assert.deepEqual(traceLinkForLookup(result("dns_error", "SERVFAIL")), {
    href: "/dns-trace?name=www.example.com&type=A",
    reason: "servfail",
  });
  assert.deepEqual(traceLinkForLookup(result("nxdomain", "NXDOMAIN", "MX")), {
    href: "/dns-trace?name=www.example.com&type=MX",
    reason: "nxdomain",
  });
  assert.equal(traceLinkForLookup(result("no_answer", "NOERROR")), null);
  assert.equal(traceLinkForLookup(result("nxdomain", "NXDOMAIN", "PTR")), null);
});

test("turns IPv4 and IPv6 addresses into reverse-DNS question names", () => {
  assert.equal(reverseDnsName("8.8.8.8"), "8.8.8.8.in-addr.arpa");
  assert.equal(
    reverseDnsName("2001:4860:4860::8888"),
    "8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.ip6.arpa",
  );
  assert.throws(() => reverseDnsName("example.com"), /valid IPv4 or IPv6/);
});

test("nullableBoolean preserves true, false, and missing or invalid", () => {
  assert.equal(nullableBoolean(true), true);
  assert.equal(nullableBoolean(false), false);
  assert.equal(nullableBoolean(undefined), null);
  assert.equal(nullableBoolean(null), null);
  assert.equal(nullableBoolean(0), null);
  assert.equal(nullableBoolean("false"), null);
});

test("normalizes resolver TTL and never invents missing flags", () => {
  const normalized = normalizeProviderResponse({
    provider: "cloudflare",
    requestedName: "www.example.com",
    requestedType: "A",
    rawResponse: {
      Status: 0,
      AD: true,
      CD: false,
      Answer: [
        { name: "www.example.com.", type: 5, TTL: 300, data: "edge.example.net." },
        { name: "edge.example.net.", type: 1, TTL: "bad", data: "192.0.2.10" },
      ],
    },
    cnameAsTerminal: false,
  });

  assert.deepEqual(normalized.flags, {
    authenticatedData: true,
    checkingDisabled: false,
    recursionDesired: null,
    recursionAvailable: null,
    truncated: null,
  });
  assert.equal(normalized.aliasChain[0].resolverTtlSeconds, 300);
  assert.equal(normalized.terminalRecords[0].resolverTtlSeconds, null);
  assert.equal(normalized.terminalRecords[0].ownerName, "edge.example.net");
  assert.ok(normalized.warnings.some((warning) => warning.code === "provider_field_invalid"));
});

test("distinguishes absent optional sections from reported empty sections", () => {
  const absent = normalizeProviderResponse({
    provider: "google",
    requestedName: "example.com",
    requestedType: "A",
    rawResponse: { Status: 0 },
    cnameAsTerminal: false,
  });
  assert.equal(absent.authorityRecords, null);
  assert.equal(absent.additionalRecords, null);
  assert.equal(absent.comments, null);

  const empty = normalizeProviderResponse({
    provider: "google",
    requestedName: "example.com",
    requestedType: "A",
    rawResponse: { Status: 0, Authority: [], Additional: [], Comment: [] },
    cnameAsTerminal: false,
  });
  assert.deepEqual(empty.authorityRecords, []);
  assert.deepEqual(empty.additionalRecords, []);
  assert.deepEqual(empty.comments, []);

  const invalid = normalizeProviderResponse({
    provider: "google",
    requestedName: "example.com",
    requestedType: "A",
    rawResponse: { Status: 0, Authority: {}, Additional: "bad", Comment: 1 },
    cnameAsTerminal: false,
  });
  assert.equal(invalid.authorityRecords, null);
  assert.equal(invalid.additionalRecords, null);
  assert.equal(invalid.comments, null);
  assert.ok(invalid.warnings.length >= 3);
});

test("deduplicates a compatible alias chain and keeps the lowest reported resolver TTL", () => {
  const result = buildUnifiedAliasChain("www.example.com", [
    {
      requestedType: "A",
      aliasChain: [
        { from: "www.example.com", to: "edge.example.net", resolverTtlSeconds: 300 },
        { from: "edge.example.net", to: "origin.example.net", resolverTtlSeconds: 120 },
      ],
    },
    {
      requestedType: "AAAA",
      aliasChain: [
        { from: "www.example.com", to: "edge.example.net", resolverTtlSeconds: 280 },
      ],
    },
  ]);

  assert.equal(result.consistent, true);
  assert.deepEqual(result.aliasChain, [
    { from: "www.example.com", to: "edge.example.net", resolverTtlSeconds: 280 },
    { from: "edge.example.net", to: "origin.example.net", resolverTtlSeconds: 120 },
  ]);
});

test("does not collapse inconsistent aliases", () => {
  const result = buildUnifiedAliasChain("www.example.com", [
    {
      requestedType: "A",
      aliasChain: [{ from: "www.example.com", to: "a.example.net", resolverTtlSeconds: 30 }],
    },
    {
      requestedType: "AAAA",
      aliasChain: [{ from: "www.example.com", to: "b.example.net", resolverTtlSeconds: 30 }],
    },
  ]);

  assert.equal(result.consistent, false);
  assert.deepEqual(result.aliasChain, []);
  assert.ok(result.warnings.some((warning) => warning.code === "alias_chain_inconsistent"));
});

test("detects alias loops and excessive depth", () => {
  const loop = normalizeAliasEdges("a.example", [
    { from: "a.example", to: "b.example", resolverTtlSeconds: 10 },
    { from: "b.example", to: "a.example", resolverTtlSeconds: 10 },
  ]);
  assert.ok(loop.warnings.some((warning) => warning.code === "alias_loop_detected"));

  const edges = Array.from({ length: 17 }, (_, index) => ({
    from: `n${index}.example`,
    to: `n${index + 1}.example`,
    resolverTtlSeconds: 10,
  }));
  const deep = normalizeAliasEdges("n0.example", edges, 16);
  assert.equal(deep.aliasChain.length, 16);
  assert.ok(deep.warnings.some((warning) => warning.code === "alias_depth_exceeded"));
});

test("explicit CNAME lookup keeps the alias as a terminal requested result", () => {
  const normalized = normalizeProviderResponse({
    provider: "cloudflare",
    requestedName: "www.example.com",
    requestedType: "CNAME",
    rawResponse: {
      Status: 0,
      Answer: [{ name: "www.example.com.", type: 5, TTL: 300, data: "edge.example.net." }],
    },
    cnameAsTerminal: true,
  });
  assert.equal(normalized.aliasChain.length, 1);
  assert.equal(normalized.terminalRecords.length, 1);
  assert.equal(normalized.terminalRecords[0].type, "CNAME");
});

test("All records uses every offered type as separate queries with fixed DO/CD values", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const query = dnsPacket.decode(Buffer.from(init.body));
    calls.push({ url: new URL(url), init, query });
    return wireResponse(init.body);
  };

  const result = await lookupDns(
    { name: "example.com", selection: "all", resolver: "cloudflare" },
    { fetchImpl },
  );

  assert.deepEqual(ALL_RECORD_TYPES, [
    "A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY",
  ]);
  assert.equal(calls.length, ALL_RECORD_TYPES.length);
  assert.deepEqual(calls.map((call) => call.query.questions[0].type), ALL_RECORD_TYPES);
  assert.ok(calls.every((call) => call.url.href === "https://cloudflare-dns.com/dns-query"));
  assert.ok(calls.every((call) => call.init.method === "POST"));
  assert.ok(calls.every((call) => call.query.flag_cd === false));
  assert.ok(calls.every((call) => call.query.additionals.length === 0));
  assert.ok(result.queryResults.every((query) => query.flags.authenticatedData === true));
});

test("PTR accepts an IP address, sends one reverse-DNS query, and stays out of All", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const query = dnsPacket.decode(Buffer.from(init.body));
    calls.push(query.questions[0]);
    return wireResponse(init.body, [{ name: query.questions[0].name, type: "PTR", ttl: 60, data: "dns.google" }]);
  };

  const result = await lookupDns(
    { name: "8.8.8.8", selection: "PTR", resolver: "google" },
    { fetchImpl },
  );

  assert.equal(ALL_RECORD_TYPES.includes("PTR"), false);
  assert.deepEqual(calls, [{ name: "8.8.8.8.in-addr.arpa", type: "PTR", class: "IN" }]);
  assert.equal(result.query.normalizedName, "8.8.8.8");
  assert.equal(result.query.dnsQuestionName, "8.8.8.8.in-addr.arpa");
  assert.equal(result.queryResults[0].terminalRecords[0].value, "dns.google");
});

test("an IP address requires PTR rather than a forward-record lookup", async () => {
  await assert.rejects(
    lookupDns({ name: "8.8.8.8", selection: "A", resolver: "cloudflare" }),
    /Choose PTR/,
  );
});

test("All records excludes CNAME edges from terminal counts and preserves raw responses", async () => {
  const fetchImpl = async (_url, init) => {
    const type = dnsPacket.decode(Buffer.from(init.body)).questions[0].type;
    if (type === "A") {
      return wireResponse(init.body, [
        { name: "www.example.com", type: "CNAME", ttl: 200, data: "edge.example.net" },
        { name: "edge.example.net", type: "A", ttl: 100, data: "192.0.2.1" },
      ]);
    }
    if (type === "CNAME") {
      return wireResponse(init.body, [
        { name: "www.example.com", type: "CNAME", ttl: 190, data: "edge.example.net" },
      ]);
    }
    return wireResponse(init.body);
  };

  const result = await lookupDns(
    { name: "www.example.com", selection: "all", resolver: "google" },
    { fetchImpl },
  );
  const aResult = result.queryResults.find((query) => query.requestedType === "A");
  const cnameResult = result.queryResults.find((query) => query.requestedType === "CNAME");

  assert.equal(result.aliasChain.length, 1);
  assert.equal(aResult.terminalRecords.length, 1);
  assert.equal(aResult.terminalRecords[0].ownerName, "edge.example.net");
  assert.equal(cnameResult.terminalRecords.length, 0);
  assert.ok(aResult.rawResponse);
  assert.ok(cnameResult.rawResponse);
});

test("legacy common selection normalizes to All", () => {
  assert.equal(normalizeSelection("common"), "all");
});

test("weighted limits allow 20 All bundles or 100 individual requests per window", () => {
  clearDnsLookupLimitsForTests();
  for (let index = 0; index < 20; index += 1) {
    assert.equal(consumeDnsLookupLimit("all", rateLimitCost("all")).allowed, true);
  }
  assert.equal(consumeDnsLookupLimit("all", rateLimitCost("all")).allowed, false);

  clearDnsLookupLimitsForTests();
  for (let index = 0; index < 100; index += 1) {
    assert.equal(consumeDnsLookupLimit("single", rateLimitCost("A")).allowed, true);
  }
  assert.equal(consumeDnsLookupLimit("single", rateLimitCost("A")).allowed, false);
});

test("formats Resolver TTL as remaining resolver cache time", () => {
  assert.equal(formatResolverTtl(300), "300 seconds, about 5 minutes remaining");
  assert.equal(formatResolverTtl(null), "Not reported");
  assert.equal(formatAuthoritativeTtl(300), "300 seconds, about 5 minutes");
});

test("parses type-specific record fields without changing the raw normalized record", () => {
  const mx = { ownerName: "example.com", type: "MX", typeCode: 15, value: "10 mail.example.com.", resolverTtlSeconds: 60 };
  assert.deepEqual(recordFields(mx), [
    { label: "Priority", value: "10" },
    { label: "Mail exchanger", value: "mail.example.com" },
  ]);
  assert.equal(mx.value, "10 mail.example.com.");

  const caa = { ownerName: "example.com", type: "CAA", typeCode: 257, value: "\\# 22 00 05 69 73 73 75 65 6c 65 74 73 65 6e 63 72 79 70 74 2e 6f 72 67", resolverTtlSeconds: 60 };
  assert.deepEqual(recordFields(caa), [
    { label: "Flags", value: "0" },
    { label: "Property", value: "issue" },
    { label: "Value", value: "letsencrypt.org" },
  ]);
  assert.match(caa.value, /^\\# 22/);

  const ptr = { ownerName: "8.8.8.8.in-addr.arpa", type: "PTR", typeCode: 12, value: "dns.google.", resolverTtlSeconds: 60 };
  assert.deepEqual(recordFields(ptr), [{ label: "Hostname", value: "dns.google" }]);
});

test("keeps every CAA policy visible and summarizes issue and issuewild separately", () => {
  const records = [
    ...Array.from({ length: 6 }, (_, index) => ({ ownerName: "example.com", type: "CAA", typeCode: 257, value: `0 issue \"ca${index}.example\"`, resolverTtlSeconds: 60 })),
    ...Array.from({ length: 5 }, (_, index) => ({ ownerName: "example.com", type: "CAA", typeCode: 257, value: `0 issuewild \"wild${index}.example\"`, resolverTtlSeconds: 60 })),
  ];
  assert.deepEqual(caaPropertyCounts(records), [
    { property: "issue", count: 6 },
    { property: "issuewild", count: 5 },
  ]);
});

test("builds and parses Team Cymru DNS enrichment names without losing network fields", () => {
  assert.equal(addressToCymruName("1.1.1.1"), "1.1.1.1.origin.asn.cymru.com");
  assert.equal(
    addressToCymruName("2606:4700:4700::1111"),
    "1.1.1.1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.7.4.0.0.7.4.6.0.6.2.origin6.asn.cymru.com",
  );
  assert.deepEqual(parseCymruOrigin("13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11"), {
    asn: 13335,
    prefix: "1.1.1.0/24",
    countryCode: "AU",
  });
  assert.equal(parseCymruAsnName("13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc."), "CLOUDFLARENET - Cloudflare, Inc.");
});

test("resolves nameserver addresses and attaches best-effort ASN details", async () => {
  const fetchImpl = async (_url, init) => {
    const question = dnsPacket.decode(Buffer.from(init.body)).questions[0];
    if (question.name === "jill.ns.cloudflare.com" && question.type === "A") {
      return wireResponse(init.body, [{ name: question.name, type: "A", ttl: 300, data: "172.64.32.122" }]);
    }
    if (question.name === "122.32.64.172.origin.asn.cymru.com" && question.type === "TXT") {
      return wireResponse(init.body, [{ name: question.name, type: "TXT", ttl: 300, data: [Buffer.from("13335 | 172.64.32.0/24 | US | arin | 2015-02-25")] }]);
    }
    if (question.name === "AS13335.asn.cymru.com" && question.type === "TXT") {
      return wireResponse(init.body, [{ name: question.name, type: "TXT", ttl: 300, data: [Buffer.from("13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US")] }]);
    }
    return wireResponse(init.body);
  };
  const result = await enrichDnsResults([{
    terminalRecords: [{ ownerName: "example.com", type: "NS", typeCode: 2, value: "jill.ns.cloudflare.com.", resolverTtlSeconds: 300 }],
  }], { fetchImpl });

  assert.deepEqual(result.nameserverAddresses, [{ nameserver: "jill.ns.cloudflare.com", addresses: ["172.64.32.122"] }]);
  assert.deepEqual(result.addressDetails, [{
    address: "172.64.32.122",
    asn: 13335,
    networkName: "CLOUDFLARENET - Cloudflare, Inc., US",
    prefix: "172.64.32.0/24",
    countryCode: "US",
  }]);
});

test("exports readable DNS records as escaped CSV with TTL meaning intact", () => {
  const csv = dnsRecordsCsv({
    resolverLabel: "Cloudflare",
    authoritative: false,
    queryResults: [{
      requestedType: "TXT",
      terminalRecords: [{ ownerName: "example.com", type: "TXT", typeCode: 16, value: '"hello, world"', resolverTtlSeconds: 300 }],
    }],
  });
  assert.match(csv, /^requested_type,owner_name,value,ttl_kind,ttl_seconds,resolver\r?\n/);
  assert.match(csv, /TXT,example\.com,"""hello, world""",resolver_remaining,300,Cloudflare/);
});
