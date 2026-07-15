# Architecture

DNS Tools is one Next.js application with seven focused pages and seven matching server routes. There is no database and no lookup-history service.

The application owns its domain root. `/` is the DNS Tools hub, and every tool uses a flat route such as `/dns-lookup` or `/dnssec-checker`. The older `/dns-tools` and `/dns-tools/<tool>` forms permanently redirect to the flat locations. The hosted Version127 website keeps its separate `/dns-tools/<tool>` namespace.

## Request path

1. The browser submits a name and the small set of options supported by that tool.
2. A same-origin Next.js API route validates the JSON body and applies a weighted in-memory rate limit.
3. The route calls the relevant engine in `lib/dns` with an abort signal and a fixed timeout.
4. The engine sends DNS-over-HTTPS or bounded direct DNS queries.
5. Provider data is normalized without turning missing values into false or empty values.
6. The page renders the useful answer and keeps the complete raw response beside the relevant evidence.

## Code boundaries

- `lib/dns/dns-wire.ts` encodes and decodes DNS wire messages.
- `lib/dns/doh.ts` talks to the fixed public resolver endpoints.
- `lib/dns/authoritative.ts` performs direct UDP and TCP DNS queries after public-address validation.
- `lib/dns/lookup.ts` runs record lookups and the defined All bundle.
- `lib/dns/trace.ts` follows iterative referrals from reviewed root-server addresses.
- `lib/dns/diagnostics.ts` powers change, delegation, SOA, and CAA checks.
- `lib/dns/dnssec.ts` runs local cryptographic validation and collects supporting evidence.
- `lib/dns/types.ts`, `diagnostic-types.ts`, and `trace-types.ts` define normalized result contracts.
- `lib/dns/*presentation*`, `format-record.ts`, and `export.ts` format records without changing their meaning.
- `app/(site)/page.tsx` owns the hub, while the seven sibling route folders own the flat tool pages.
- `app/(site)/_dns-tools` contains shared sidebar, result, and route-family presentation code without creating another public route.

The top bar contains the Version127 logo and the DNS Tools product name. Version127 attribution appears in the footer, so it is not repeated as a separate top-bar link.

Result findings and information boxes use neutral full borders or natural spacing. They never use a colored line along the left edge. Neutral connector lines remain only where they show a real sequence or validation chain.

## Public resolvers

DNS Lookup supports Cloudflare, Google Public DNS, Quad9, OpenDNS, AdGuard DNS, Control D, Yandex DNS, and an authoritative nameserver. Public providers use RFC 8484 DNS wire messages rather than provider-specific JSON formats.

The endpoint is chosen from a fixed server registry. A browser request cannot provide a URL.

## Direct DNS

Trace and authoritative diagnostics use Node's UDP and TCP networking. Before a connection is attempted, the target must be a public IP address. The engine rejects loopback, private, link-local, documentation, multicast, reserved, and other non-public ranges.

UDP is tried first. A truncated reply is retried over TCP. Response IDs must match, replies have a maximum size, and every operation has a timeout.

## State and scaling

Results are not stored. The only mutable server state is the rate-limit map inside one Node process. That is appropriate for a small self-hosted instance. Multiple replicas need a shared limit at the reverse proxy or a future shared rate-limit adapter.

## SEO boundary

The explanatory page content is server-rendered. Interactive results are fetched after the visitor submits the form. Self-hosted installations default to `noindex`, and URLs with query parameters return an `X-Robots-Tag: noindex, follow` header.
