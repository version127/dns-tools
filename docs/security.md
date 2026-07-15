# Security model

DNS Tools accepts a name from a visitor and performs server-side network work. The server must never become a general HTTP proxy, arbitrary DNS relay, or way to reach private network addresses.

## Upstream control

Public DNS-over-HTTPS endpoints are selected from a fixed registry. Request bodies cannot include a URL. Authoritative targets come from bounded DNS discovery and must pass public-address validation immediately before a connection.

## Bounds

The implementation limits request-body size while it is being read, DNS message size, per-query time, total request time, server attempts, nameserver hostnames, referrals, aliases, nested resolution, and total DNS questions. UDP replies that declare truncation retry through TCP within the same bounds.

## Browser boundary

Browser requests must be same-origin. No permissive CORS header is sent. Command-line clients without an Origin header can call a local instance, so a public deployment still needs rate limiting and network-level protection.

## Rate limiting

The included limiter is weighted because an All lookup, trace, or multi-source diagnostic performs more upstream work than one A query. Its map lives inside one Node process and has a fixed entry cap so changing client keys cannot grow memory without a bound. It is a practical guardrail for one self-hosted instance, not distributed denial-of-service protection.

## Forwarded IP headers

The server reads common proxy headers when choosing a rate-limit key. A trusted proxy must overwrite those headers. Do not expose the app directly while also trusting arbitrary visitor-supplied forwarding headers.

## Output

React escapes displayed text. API errors and per-server failures return concise messages without stack traces, local socket details, or filesystem paths. CSV and JSON downloads are generated from normalized values and should remain covered by injection and escaping tests.
