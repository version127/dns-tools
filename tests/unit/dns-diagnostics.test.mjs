import assert from "node:assert/strict";
import test from "node:test";

import { assessDelegation, checkCaaPolicy, compareSerials, negativeCacheTtlSeconds, parseCaaRecord, parseSoaRecord } from "../../lib/dns/diagnostics.ts";
import { checkDnssec, dnssecSignatureFromRrsig, parseDelvVerdict } from "../../lib/dns/dnssec.ts";
import { csvFromRows, groupDnsSources, groupSoaObservations } from "../../lib/dns/diagnostic-presentation.ts";

test("SOA records retain every field and serial comparison follows RFC 1982 wraparound", () => {
  assert.deepEqual(parseSoaRecord({ name: "example.com", type: 6, TTL: 300, data: "ns1.example.com hostmaster.example.com 4294967295 3600 600 86400 300" }), {
    ownerName: "example.com",
    primaryNameserver: "ns1.example.com",
    responsibleMailbox: "hostmaster.example.com",
    serial: 4294967295,
    refreshSeconds: 3600,
    retrySeconds: 600,
    expireSeconds: 86400,
    minimumSeconds: 300,
    ttlSeconds: 300,
  });
  assert.equal(compareSerials(0, 4294967295), "left-newer");
  assert.equal(compareSerials(4294967295, 0), "right-newer");
  assert.equal(compareSerials(5, 5), "same");
  assert.equal(compareSerials(2147483648, 0), "undefined");
});

test("CAA parser preserves issuewild and the critical flag", () => {
  assert.deepEqual(parseCaaRecord({ name: "example.com", type: 257, TTL: 60, data: '128 issuewild "letsencrypt.org; validationmethods=dns-01"' }), {
    ownerName: "example.com",
    flags: 128,
    critical: true,
    tag: "issuewild",
    value: "letsencrypt.org; validationmethods=dns-01",
    ttlSeconds: 60,
    valid: true,
  });
});

test("CAA policy walks toward the parent and applies issue to wildcard when issuewild is absent", async () => {
  const calls = [];
  const publicQuery = async (name) => {
    calls.push(name);
    return {
      Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, AA: false, Question: [], Authority: [], Additional: [],
      Answer: name === "example.com" ? [{ name, type: 257, TTL: 300, data: '0 issue "letsencrypt.org"' }] : [],
    };
  };
  const result = await checkCaaPolicy("www.example.com", { publicQuery });
  assert.deepEqual(calls, ["www.example.com", "example.com"]);
  assert.equal(result.effectiveName, "example.com");
  assert.deepEqual(result.normal.issuers, ["letsencrypt.org"]);
  assert.deepEqual(result.wildcard.issuers, ["letsencrypt.org"]);
  assert.equal(result.usesIssueForWildcard, true);
});

test("CAA lookup does not silently skip a failed level", async () => {
  const result = await checkCaaPolicy("www.example.com", { publicQuery: async () => { throw new Error("timeout"); } });
  assert.equal(result.status, "undetermined");
  assert.equal(result.levels.length, 1);
  assert.equal(result.error, "timeout");
});

test("CAA follows an alias but resumes parent search on the original certificate name", async () => {
  const calls = [];
  const publicQuery = async (name) => {
    calls.push(name);
    const answers = name === "www.example.com"
      ? [{ name, type: 5, TTL: 60, data: "customer.hosting.test" }]
      : name === "example.com"
        ? [{ name, type: 257, TTL: 300, data: '0 issue "letsencrypt.org"' }]
        : [];
    return { Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, AA: false, Question: [], Authority: [], Additional: [], Answer: answers };
  };
  const result = await checkCaaPolicy("www.example.com", { publicQuery });
  assert.deepEqual(calls, ["www.example.com", "customer.hosting.test", "example.com"]);
  assert.equal(result.effectiveName, "example.com");
  assert.equal(result.levels[1].searchReason, "alias");
  assert.equal(result.levels[2].searchReason, "parent");
});

test("DNSSEC verdicts distinguish secure, insecure, bogus, and unknown output", () => {
  assert.equal(parseDelvVerdict("resolution successful: fully validated").verdict, "secure");
  assert.equal(parseDelvVerdict("unsigned answer; trust answer").verdict, "insecure");
  assert.equal(parseDelvVerdict("validation failed: no valid signature").verdict, "bogus");
  assert.equal(parseDelvVerdict("connection refused", 1).verdict, "indeterminate");
});

test("DNSSEC result comes from cryptographic validation rather than the resolver AD flag", async () => {
  const result = await checkDnssec(
    { name: "example.com", recordType: "A" },
    {
      validator: async () => ({
        verdict: "secure",
        validationOutcome: "secure-positive",
        explanation: "validated",
        rawReport: { verdict: "secure-positive" },
        exitCode: 0,
        zones: [".", "com", "example.com"],
        steps: [{ kind: "answer", qname: "example.com.", qtype: "A", ok: true, detail: "RRSIG verified; 1 A record" }],
        signatures: [],
      }),
      publicQuery: async (name, type) => ({
        Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, AA: false, Question: [], Authority: [], Additional: [],
        Answer: type === "DS"
          ? [{ name, type: 43, TTL: 60, data: "12345 13 2 ABCD" }]
          : type === "DNSKEY"
            ? [{ name, type: 48, TTL: 60, data: "257 3 13 AAAA" }]
            : [{ name, type: 1, TTL: 60, data: "192.0.2.10" }],
      }),
    },
  );
  assert.equal(result.verdict, "secure");
  assert.equal(result.validation.outcome, "secure-positive");
  assert.equal(result.validation.steps[0].kind, "answer");
  assert.equal(result.answer.records[0].value, "192.0.2.10");
  assert.equal(result.chain.every((step) => step.dnskey.authenticatedData === false), true);
  assert.deepEqual(result.chain.map((step) => step.zone), [".", "com", "example.com"]);
});

test("DNSSEC signatures keep their own validity window and time remaining", () => {
  const signature = dnssecSignatureFromRrsig(
    {
      typeCovered: 1,
      algorithm: 13,
      labels: 2,
      originalTTL: 300,
      signatureExpiration: 1_800,
      signatureInception: 900,
      keyTag: 2371,
      signerName: "example.com.",
      signature: new Uint8Array(),
      signerNameRdataEndOffset: 0,
    },
    { ownerName: "www.example.com.", queryName: "www.example.com.", queryType: 1 },
    new Date(1_000_000),
  );

  assert.equal(signature.typeCovered, "A");
  assert.equal(signature.algorithmName, "ECDSAP256SHA256");
  assert.equal(signature.status, "valid");
  assert.equal(signature.secondsRemaining, 800);
  assert.equal(signature.keyTag, 2371);
  assert.equal(signature.signerName, "example.com");
});

test("delegation assessment reports each failed transport, glue drift, and shared infrastructure", () => {
  const assessment = assessDelegation({
    zone: "example.com",
    parentDelegatedNameservers: ["ns1.example.com", "ns2.example.com"],
    childPublishedNameservers: ["ns1.example.com", "ns2.example.com"],
    parentGlue: [
      { hostname: "ns1.example.com", address: "192.0.2.10", ttlSeconds: 300 },
      { hostname: "ns2.example.com", address: "192.0.2.10", ttlSeconds: 300 },
    ],
    nameserverAddresses: [
      { hostname: "ns1.example.com", addresses: ["192.0.2.10"] },
      { hostname: "ns2.example.com", addresses: ["192.0.2.10"] },
    ],
    reachability: [
      {
        server: { hostname: "ns1.example.com", address: "192.0.2.10" },
        udp: { reachable: false, authoritative: null, responseCode: null, error: "timeout" },
        tcp: { reachable: true, authoritative: true, responseCode: "NOERROR", error: null },
        soa: null,
        rawResponses: { udp: null, tcp: null },
      },
    ],
    authoritativeAddressObservations: [
      {
        hostname: "ns1.example.com",
        server: { hostname: "ns1.example.com", address: "192.0.2.10" },
        addresses: ["192.0.2.11"],
        authoritative: true,
        error: null,
        rawResponses: { A: null, AAAA: null },
      },
    ],
    addressDetails: [{ address: "192.0.2.10", asn: 64500, networkName: "Example Network", prefix: "192.0.2.0/24", countryCode: "US" }],
  });

  assert.ok(assessment.findings.some((finding) => finding.includes("did not answer over UDP")));
  assert.ok(assessment.findings.some((finding) => finding.includes("parent glue") && finding.includes("192.0.2.11")));
  assert.ok(assessment.findings.some((finding) => finding.includes("same IP address")));
  assert.ok(assessment.notes.some((note) => note.includes("AS64500")));
  assert.ok(assessment.notes.some((note) => note.includes("192.0.2.0/24")));
});

test("negative SOA cache time uses the lower of the SOA TTL and MINIMUM", () => {
  assert.equal(negativeCacheTtlSeconds({ ttlSeconds: 900, minimumSeconds: 300 }), 300);
  assert.equal(negativeCacheTtlSeconds({ ttlSeconds: 120, minimumSeconds: 300 }), 120);
  assert.equal(negativeCacheTtlSeconds({ ttlSeconds: null, minimumSeconds: 300 }), null);
});

test("diagnostic source grouping removes repeated answers without losing source TTLs", () => {
  const sources = [
    { id: "one", label: "ns1", kind: "authoritative", server: { hostname: "ns1", address: "192.0.2.1" }, responseCode: "NOERROR", authoritative: true, authenticatedData: null, records: [{ ownerName: "example.com", type: "A", typeCode: 1, value: "192.0.2.10", resolverTtlSeconds: 300 }], error: null, rawResponse: { one: true } },
    { id: "two", label: "ns2", kind: "authoritative", server: { hostname: "ns2", address: "192.0.2.2" }, responseCode: "NOERROR", authoritative: true, authenticatedData: null, records: [{ ownerName: "example.com", type: "A", typeCode: 1, value: "192.0.2.10", resolverTtlSeconds: 280 }], error: null, rawResponse: { two: true } },
  ];
  const groups = groupDnsSources(sources);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sources.length, 2);
  assert.deepEqual(groups[0].sources.map((source) => source.records[0].resolverTtlSeconds), [300, 280]);
});

test("SOA grouping keeps different serials separate but combines identical addresses", () => {
  const base = { ownerName: "example.com", primaryNameserver: "ns1.example.com", responsibleMailbox: "hostmaster.example.com", serial: 10, refreshSeconds: 3600, retrySeconds: 600, expireSeconds: 86400, minimumSeconds: 300, ttlSeconds: 300 };
  const grouped = groupSoaObservations([
    { server: { hostname: "ns1.example.com", address: "192.0.2.1" }, soa: base, authoritative: true, error: null, rawResponses: {} },
    { server: { hostname: "ns1.example.com", address: "2001:db8::1" }, soa: base, authoritative: true, error: null, rawResponses: {} },
    { server: { hostname: "ns2.example.com", address: "192.0.2.2" }, soa: { ...base, serial: 9 }, authoritative: true, error: null, rawResponses: {} },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].addresses.length, 2);
  assert.equal(grouped[1].soa.serial, 9);
});

test("CSV export escapes values that contain commas and quotes", () => {
  assert.equal(csvFromRows([["name", "value"], ["example.com", '0 issue "ca.example, inc"']]), 'name,value\r\nexample.com,"0 issue ""ca.example, inc"""');
});
