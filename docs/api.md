# API

The included pages call seven JSON endpoints. Requests are processed on the server because browsers cannot perform the direct UDP and TCP DNS work used by trace and authoritative diagnostics.

## Common behavior

- Method: `POST`
- Request content type: `application/json`
- Maximum request body: 4 KiB
- Successful responses: `200` with `Cache-Control: no-store`
- Validation failures: `400`
- Cross-origin browser requests: `403`
- Rate limit: `429` with `Retry-After`
- Safe timeout: `504` for the longer diagnostic routes
- Error body: `{ "error": { "code": "...", "message": "..." } }`

The rate-limit response includes `X-RateLimit-Remaining`. Costs differ because a trace or multi-source comparison creates more DNS work than a single record query.

## DNS Lookup

```http
POST /api/dns/lookup
```

```json
{
  "name": "example.com",
  "selection": "all",
  "resolver": "cloudflare"
}
```

`selection` accepts `all`, `A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT`, `CAA`, `SOA`, `SRV`, `DS`, `DNSKEY`, or `PTR`. PTR requires an IP address and is never part of All. `resolver` accepts `cloudflare`, `google`, `quad9`, `opendns`, `adguard`, `controld`, `yandex`, or `authoritative`.

The response includes the normalized query, selected resolver, timing, ordered per-type query results, alias observations, the deduplicated alias chain when compatible, warnings, nullable DNS flags, terminal records with their actual owner names, raw responses, and optional network enrichment.

## DNS Trace Explorer

```http
POST /api/dns/trace
```

```json
{ "name": "www.example.com", "recordType": "A" }
```

One record type is required. All, ANY, PTR, resolver selection, DO, and CD overrides are rejected. The response contains the final name, outcome, ordered trace steps, each question actually sent, server attempts, referral NS sets, glue and other referral addresses, answers, response codes, timings, authority status, and every raw DNS response.

## DNS Change Checker

```http
POST /api/dns/change-checker
```

```json
{
  "name": "example.com",
  "recordType": "A",
  "expectedAnswer": "93.184.216.34"
}
```

`expectedAnswer` is optional. The response starts with authoritative observations and then public resolver observations. Every source retains its record set, TTL meaning, errors, timing, addresses, and raw response. Record order is not treated as meaningful.

## Nameserver Delegation Checker

```http
POST /api/dns/nameserver-checker
```

```json
{ "name": "example.com" }
```

The response contains the discovered zone, parent and child NS sets, actual referral glue, child-published addresses, UDP and TCP reachability observations, authoritative SOA status, mismatches, shared-address and network context, and raw parent, child, address, and transport responses. `ipv6Connectivity` reports whether the checker could use IPv6. If it is `false`, IPv6 reachability rows remain in the response with `skippedReason: "checker_ipv6_unavailable"`; they are not reported as failures of the domain.

## DNSSEC Chain Checker

```http
POST /api/dns/dnssec-checker
```

```json
{ "name": "example.com", "recordType": "A" }
```

The response verdict is `secure`, `insecure`, `bogus`, or `indeterminate`. It includes the validator's ordered walk steps, requested answer, DS and DNSKEY evidence, RRSIG validity windows, and complete structured validator report. The verdict comes from local cryptographic validation rather than a resolver's AD flag.

## SOA Consistency Checker

```http
POST /api/dns/soa-checker
```

```json
{ "name": "example.com" }
```

The response contains every authoritative address observation, MNAME, RNAME, serial, refresh, retry, expire, minimum, SOA TTL, negative-cache TTL, reachability, agreement findings, and raw responses. Serial ordering follows RFC 1982 arithmetic.

## CAA Policy Checker

```http
POST /api/dns/caa-checker
```

```json
{ "name": "www.example.com" }
```

The response records every searched level as requested name, alias, or parent. It reports the first effective policy, normal and wildcard issuance separately, critical and unknown properties, malformed records, validated `iodef` syntax, and each raw response. The checker never contacts an `iodef` destination.

## Health

```http
GET /api/health
```

```json
{ "status": "ok", "service": "dns-tools" }
```

This is a process-liveness check. It does not contact a resolver or authoritative server.

## Raw and nullable fields

DNS flags use `true`, `false`, or `null`. Missing provider data remains `null`; it is never converted to `false`. Optional sections that were absent remain `null`, while sections explicitly returned as empty remain empty arrays.

Public resolver TTL values are usually remaining cache lifetime. They are returned as `resolverTtlSeconds`. Direct authoritative TTL values use the same numeric storage field for compatibility but are labeled as authoritative values in the interface.

The TypeScript contracts in `lib/dns/types.ts`, `lib/dns/diagnostic-types.ts`, `lib/dns/dnssec-types.ts`, and `lib/dns/trace-types.ts` are the source definitions. `openapi.yaml` documents the HTTP requests and stable top-level response envelope.
