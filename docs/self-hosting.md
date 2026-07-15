# Self-hosting

## What the host needs

- Node.js 24 or Docker
- Outbound TCP 443 for DNS-over-HTTPS
- Outbound UDP 53 for direct authoritative DNS
- Outbound TCP 53 for truncated responses and transport checks
- Enough memory for a Next.js server and several bounded DNS operations

No database, volume, account system, or API key is required.

## Docker Compose

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:1273`. The container health check calls `/api/health` without performing an external lookup.

To stop it:

```bash
docker compose down
```

## Node

```bash
npm install
npm run build
npm run start
```

The default port is `1273`.

## Reverse proxy

Forward ordinary HTTP traffic to `127.0.0.1:1273`. Preserve the original host and scheme. Overwrite `X-Forwarded-For`, `X-Real-IP`, and similar client-address headers at the trusted proxy rather than accepting values supplied by the visitor.

Add a second request limit at the proxy for public installations. The included limiter is held in one Node process and is not shared across replicas.

## Indexing

Self-hosted copies default to `noindex`. To expose a public, indexable installation:

```env
NEXT_PUBLIC_SITE_URL=https://dns.example.com
DNS_TOOLS_ALLOW_INDEXING=true
```

Rebuild after changing a public site URL because Next.js uses it for generated metadata.

## Platforms that block direct DNS

If DNS Lookup works through a public resolver but Trace, SOA, delegation, or authoritative checks time out, verify that the platform allows outbound UDP and TCP port 53. Many Edge and serverless platforms only allow HTTP connections.
