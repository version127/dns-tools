import assert from "node:assert/strict";
import test from "node:test";

import {
  IANA_ROOT_SERVERS,
  TRACE_RECORD_TYPES,
  normalizeTraceRecordType,
  traceDns,
} from "../../../lib/dns/trace.ts";

const flags = { AA: false, AD: false, CD: false, RA: false, RD: false, TC: false };

function response({ answers = [], authorities = [], additionals = [], status = 0, authoritative = false } = {}) {
  return {
    ...flags,
    AA: authoritative,
    Status: status,
    Question: [],
    Answer: answers,
    Authority: authorities,
    Additional: additionals,
  };
}

test("trace record types are deliberate and reject All, ANY, and PTR", () => {
  assert.deepEqual(TRACE_RECORD_TYPES, ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA", "SRV", "DS", "DNSKEY"]);
  assert.equal(normalizeTraceRecordType("a"), "A");
  assert.throws(() => normalizeTraceRecordType("all"), /one supported record type/);
  assert.throws(() => normalizeTraceRecordType("ANY"), /one supported record type/);
  assert.throws(() => normalizeTraceRecordType("PTR"), /one supported record type/);
  assert.equal(IANA_ROOT_SERVERS.length, 13);
});

test("follows real referrals from root to TLD to the authoritative answer", async () => {
  const calls = [];
  const queryImpl = async (name, type, target) => {
    calls.push({ name, type, target });
    if (target.hostname === "a.root-servers.net") {
      return response({
        authorities: [{ name: "com", type: 2, TTL: 172800, data: "a.nic.com" }],
        additionals: [{ name: "a.nic.com", type: 1, TTL: 172800, data: "8.8.8.8" }],
      });
    }
    if (target.hostname === "a.nic.com") {
      return response({
        authorities: [{ name: "example.com", type: 2, TTL: 172800, data: "ns1.example.com" }],
        additionals: [{ name: "ns1.example.com", type: 1, TTL: 172800, data: "9.9.9.9" }],
      });
    }
    return response({
      authoritative: true,
      answers: [{ name: "www.example.com", type: 1, TTL: 300, data: "93.184.216.34" }],
    });
  };

  const result = await traceDns(
    { name: "www.example.com", recordType: "A" },
    { queryImpl, rootServers: [{ hostname: "a.root-servers.net", address: "198.41.0.4" }] },
  );

  assert.equal(result.outcome, "found");
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps.map((step) => step.stage), ["root", "tld", "authoritative"]);
  assert.equal(result.steps[0].delegatedZone, "com");
  assert.equal(result.steps[0].glueRecords[0].value, "8.8.8.8");
  assert.equal(result.steps[1].delegatedZone, "example.com");
  assert.equal(result.steps[2].answerRecords[0].value, "93.184.216.34");
  assert.deepEqual(calls.map((call) => call.target.hostname), ["a.root-servers.net", "a.nic.com", "ns1.example.com"]);
});

test("continues from the root when an answer is only a CNAME", async () => {
  let rootCalls = 0;
  const queryImpl = async (name, _type, target) => {
    if (target.hostname === "a.root-servers.net") {
      rootCalls += 1;
      return response({
        authorities: [{ name: name.endsWith("example.net") ? "net" : "com", type: 2, TTL: 60, data: "next.example" }],
        additionals: [{ name: "next.example", type: 1, TTL: 60, data: "8.8.4.4" }],
      });
    }
    if (name === "www.example.com") {
      return response({ authoritative: true, answers: [{ name, type: 5, TTL: 60, data: "edge.example.net" }] });
    }
    return response({ authoritative: true, answers: [{ name, type: 1, TTL: 60, data: "1.1.1.1" }] });
  };

  const result = await traceDns(
    { name: "www.example.com", recordType: "A" },
    { queryImpl, rootServers: [{ hostname: "a.root-servers.net", address: "198.41.0.4" }] },
  );

  assert.equal(result.outcome, "found");
  assert.equal(result.finalName, "edge.example.net");
  assert.equal(result.steps.some((step) => step.outcome === "alias"), true);
  assert.equal(rootCalls, 2);
});

test("resolves a delegated nameserver iteratively when the referral has no address", async () => {
  const calls = [];
  const queryImpl = async (name, _type, target) => {
    calls.push(`${name}@${target.hostname}`);
    if (target.hostname === "a.root-servers.net" && name === "example.com") {
      return response({
        authorities: [{ name: "com", type: 2, TTL: 60, data: "a.nic.com" }],
        additionals: [{ name: "a.nic.com", type: 1, TTL: 60, data: "8.8.8.8" }],
      });
    }
    if (target.hostname === "a.nic.com") {
      return response({ authorities: [{ name: "example.com", type: 2, TTL: 60, data: "ns.external.net" }] });
    }
    if (target.hostname === "a.root-servers.net" && name === "ns.external.net") {
      return response({
        authorities: [{ name: "net", type: 2, TTL: 60, data: "b.nic.net" }],
        additionals: [{ name: "b.nic.net", type: 1, TTL: 60, data: "1.1.1.1" }],
      });
    }
    if (target.hostname === "b.nic.net") {
      return response({ authoritative: true, answers: [{ name, type: 1, TTL: 60, data: "9.9.9.9" }] });
    }
    return response({ authoritative: true, answers: [{ name, type: 1, TTL: 60, data: "93.184.216.34" }] });
  };

  const result = await traceDns(
    { name: "example.com", recordType: "A" },
    { queryImpl, rootServers: [{ hostname: "a.root-servers.net", address: "198.41.0.4" }] },
  );

  assert.equal(result.outcome, "found");
  assert.equal(result.steps.length, 3, "supporting NS-address resolution should not be mixed into the reader's main trace");
  assert.ok(calls.includes("ns.external.net@a.root-servers.net"));
  assert.ok(calls.includes("ns.external.net@b.nic.net"));
  assert.ok(calls.includes("example.com@ns.external.net"));
});

test("separates unrelated nameserver addresses from in-domain and sibling glue", async () => {
  const queryImpl = async (name, _type, target) => {
    if (target.hostname === "a.root-servers.net") {
      return response({
        authorities: [{ name: "com", type: 2, TTL: 60, data: "a.nic.com" }],
        additionals: [{ name: "a.nic.com", type: 1, TTL: 60, data: "8.8.8.8" }],
      });
    }
    if (target.hostname === "a.nic.com") {
      return response({
        authorities: [{ name: "example.com", type: 2, TTL: 60, data: "ns.external.net" }],
        additionals: [{ name: "ns.external.net", type: 1, TTL: 60, data: "9.9.9.9" }],
      });
    }
    return response({ authoritative: true, answers: [{ name, type: 1, TTL: 60, data: "93.184.216.34" }] });
  };
  const result = await traceDns(
    { name: "example.com", recordType: "A" },
    { queryImpl, rootServers: [{ hostname: "a.root-servers.net", address: "198.41.0.4" }] },
  );

  assert.equal(result.steps[0].glueRecords.length, 1, "the root's sibling nameserver address is glue");
  assert.equal(result.steps[1].glueRecords.length, 0);
  assert.equal(result.steps[1].additionalAddressRecords.length, 1);
});

test("returns the exact stopping point when every nameserver attempt fails", async () => {
  const result = await traceDns(
    { name: "example.com", recordType: "A" },
    {
      queryImpl: async () => { throw new Error("The nameserver timed out."); },
      rootServers: [{ hostname: "a.root-servers.net", address: "198.41.0.4" }],
    },
  );

  assert.equal(result.outcome, "error");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].outcome, "error");
  assert.match(result.steps[0].message, /could not get a usable response/i);
  assert.equal(result.steps[0].attempts[0].error, "The nameserver did not answer before the timeout.");
});

test("trace accepts a website URL but not an IP address", async () => {
  const queryImpl = async (name) => response({
    authoritative: true,
    answers: [{ name, type: 1, TTL: 60, data: "1.1.1.1" }],
  });
  const result = await traceDns(
    { name: "https://www.example.com/path", recordType: "A" },
    { queryImpl, rootServers: [{ hostname: "a.root-servers.net", address: "198.41.0.4" }] },
  );
  assert.equal(result.query.normalizedName, "www.example.com");
  await assert.rejects(
    traceDns({ name: "1.1.1.1", recordType: "A" }, { queryImpl }),
    /domain or hostname rather than an IP address/,
  );
});
