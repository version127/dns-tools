const baseUrl = process.env.DNS_TOOLS_BASE_URL ?? "http://127.0.0.1:1273";
const name = process.env.DNS_TOOLS_TEST_NAME ?? "cloudflare.com";

const checks = [
  ["DNS Lookup", "lookup", { name, selection: "all", resolver: "cloudflare" }],
  ["DNS Trace Explorer", "trace", { name, recordType: "A" }],
  ["DNS Change Checker", "change-checker", { name, recordType: "A" }],
  ["Nameserver Delegation Checker", "nameserver-checker", { name }],
  ["DNSSEC Chain Checker", "dnssec-checker", { name, recordType: "A" }],
  ["SOA Consistency Checker", "soa-checker", { name }],
  ["CAA Policy Checker", "caa-checker", { name }],
];

for (const [label, endpoint, body] of checks) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/dns/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${JSON.stringify(payload)}`);
  if (!payload || typeof payload !== "object") throw new Error(`${label} returned an invalid JSON result.`);
  console.log(`${label}\t${response.status}\t${Date.now() - started} ms`);
}

console.log(`All ${checks.length} live tools completed for ${name}.`);
