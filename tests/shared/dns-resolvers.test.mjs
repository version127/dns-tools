import assert from "node:assert/strict";
import test from "node:test";

import dnsPacket from "dns-packet";

import {
  dnsResolverProfiles,
  isDnsResolver,
  resolverLabel,
} from "../../lib/dns/resolvers.ts";
import {
  decodeDnsResponse,
  encodeDnsQuery,
} from "../../lib/dns/dns-wire.ts";
import { discoverAuthoritativeTarget, isPublicDnsAddress } from "../../lib/dns/authoritative.ts";
import { queryPublicResolver } from "../../lib/dns/doh.ts";

test("offers the reviewed public resolvers and authoritative nameservers", () => {
  assert.deepEqual(dnsResolverProfiles.map((profile) => profile.id), [
    "cloudflare",
    "google",
    "quad9",
    "opendns",
    "adguard",
    "controld",
    "yandex",
    "authoritative",
  ]);
  assert.equal(dnsResolverProfiles.find((profile) => profile.id === "quad9")?.endpoint, "https://dns10.quad9.net/dns-query");
  assert.equal(dnsResolverProfiles.find((profile) => profile.id === "adguard")?.endpoint, "https://unfiltered.adguard-dns.com/dns-query");
  assert.equal(dnsResolverProfiles.find((profile) => profile.id === "controld")?.endpoint, "https://freedns.controld.com/p0");
  assert.equal(dnsResolverProfiles.find((profile) => profile.id === "yandex")?.endpoint, "https://common.dot.dns.yandex.net/dns-query");
  assert.equal(dnsResolverProfiles.find((profile) => profile.id === "authoritative")?.endpoint, null);
  assert.equal(isDnsResolver("authoritative"), true);
  assert.equal(isDnsResolver("anything-else"), false);
  assert.equal(resolverLabel("authoritative"), "Authoritative nameserver");
});

test("encodes a recursive DNS wire query with DO and CD disabled", () => {
  const decoded = dnsPacket.decode(encodeDnsQuery("example.com", "A", { recursive: true, id: 42 }));
  assert.equal(decoded.id, 42);
  assert.equal(decoded.flag_rd, true);
  assert.equal(decoded.flag_cd, false);
  assert.deepEqual(decoded.questions, [{ name: "example.com", type: "A", class: "IN" }]);
  assert.equal(decoded.additionals?.length, 0);
});

test("turns DNS wire records and flags into the normalized provider contract", () => {
  const packet = dnsPacket.encode({
    type: "response",
    id: 42,
    flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | dnsPacket.AUTHENTIC_DATA,
    questions: [{ name: "www.example.com", type: "A", class: "IN" }],
    answers: [
      { name: "www.example.com", type: "CNAME", ttl: 300, data: "edge.example.net" },
      { name: "edge.example.net", type: "A", ttl: 120, data: "192.0.2.10" },
    ],
    authorities: [{ name: "example.com", type: "NS", ttl: 600, data: "ns1.example.net" }],
    additionals: [],
  });
  const raw = decodeDnsResponse(packet);
  assert.equal(raw.Status, 0);
  assert.equal(raw.AD, true);
  assert.equal(raw.CD, false);
  assert.equal(raw.RD, true);
  assert.equal(raw.RA, true);
  assert.equal(raw.TC, false);
  assert.deepEqual(raw.Answer, [
    { name: "www.example.com", type: 5, TTL: 300, data: "edge.example.net" },
    { name: "edge.example.net", type: 1, TTL: 120, data: "192.0.2.10" },
  ]);
  assert.equal(raw.Authority?.[0]?.type, 2);
});

test("serializes structured DNS records without losing their meaning", () => {
  const packet = dnsPacket.encode({
    type: "response",
    id: 4,
    flags: 0,
    questions: [{ name: "example.com", type: "MX" }],
    answers: [
      { name: "example.com", type: "MX", ttl: 60, data: { preference: 10, exchange: "mail.example.com" } },
      { name: "example.com", type: "TXT", ttl: 60, data: [Buffer.from("hello "), Buffer.from("world")] },
      { name: "_sip._tcp.example.com", type: "SRV", ttl: 60, data: { priority: 1, weight: 2, port: 443, target: "sip.example.com" } },
      { name: "example.com", type: "DS", ttl: 60, data: { keyTag: 123, algorithm: 13, digestType: 2, digest: Buffer.from("abcd", "hex") } },
      { name: "example.com", type: "DNSKEY", ttl: 60, data: { flags: 257, algorithm: 13, key: Buffer.from("key") } },
    ],
  });
  const values = decodeDnsResponse(packet).Answer?.map((record) => record.data);
  assert.deepEqual(values, [
    "10 mail.example.com",
    '"hello world"',
    "1 2 443 sip.example.com",
    "123 13 2 ABCD",
    "257 3 13 a2V5",
  ]);
});

test("authoritative targets must be public DNS addresses", () => {
  assert.equal(isPublicDnsAddress("1.1.1.1"), true);
  assert.equal(isPublicDnsAddress("2606:4700:4700::1111"), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(isPublicDnsAddress(address), false, address);
  }
});

test("the DoH adapter posts DNS wire data only to the selected fixed endpoint", async () => {
  let call;
  const fetchImpl = async (url, init) => {
    call = { url, init };
    const query = dnsPacket.decode(Buffer.from(init.body));
    return new Response(dnsPacket.encode({
      type: "response",
      id: query.id,
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
      questions: query.questions,
      answers: [],
      authorities: [],
      additionals: [],
    }), { headers: { "content-type": "application/dns-message" } });
  };
  const result = await queryPublicResolver("example.com", "A", "yandex", { fetchImpl });
  assert.equal(call.url, "https://common.dot.dns.yandex.net/dns-query");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.accept, "application/dns-message");
  assert.equal(result.Status, 0);
});

test("discovers a public authoritative target and ignores private glue addresses", async () => {
  const calls = [];
  const bootstrapQuery = async (name, type) => {
    calls.push(`${name}:${type}`);
    const base = { Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, AA: false, Question: [], Authority: [], Additional: [] };
    if (name === "example.com" && type === "NS") {
      return { ...base, Answer: [{ name, type: 2, TTL: 300, data: "ns1.example.net" }] };
    }
    if (name === "ns1.example.net" && type === "A") {
      return { ...base, Answer: [{ name, type: 1, TTL: 300, data: "10.0.0.2" }] };
    }
    if (name === "ns1.example.net" && type === "AAAA") {
      return { ...base, Answer: [{ name, type: 28, TTL: 300, data: "2606:4700:4700::1111" }] };
    }
    return { ...base, Answer: [] };
  };
  const target = await discoverAuthoritativeTarget("www.example.com", "A", bootstrapQuery);
  assert.deepEqual(target, {
    zone: "example.com",
    hostname: "ns1.example.net",
    address: "2606:4700:4700::1111",
  });
  assert.deepEqual(calls, [
    "www.example.com:NS",
    "example.com:NS",
    "ns1.example.net:A",
    "ns1.example.net:AAAA",
  ]);
});

test("discovers the parent authority for a DS lookup", async () => {
  const bootstrapQuery = async (name, type) => {
    const base = { Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, AA: false, Question: [], Authority: [], Additional: [] };
    if (name === "com" && type === "NS") return { ...base, Answer: [{ name, type: 2, TTL: 300, data: "a.gtld.example" }] };
    if (name === "a.gtld.example" && type === "A") return { ...base, Answer: [{ name, type: 1, TTL: 300, data: "8.8.8.8" }] };
    return { ...base, Answer: [] };
  };
  const target = await discoverAuthoritativeTarget("example.com", "DS", bootstrapQuery);
  assert.equal(target.zone, "com");
});
