# Launch acceptance checklist

Run this list from a clean checkout before publishing a release.

## Reproducible install

- [ ] `npm ci` installs only what is recorded in `package-lock.json`.
- [ ] `npm audit --json` reports no known vulnerabilities.
- [ ] `npm run test:repo` finds all seven pages, APIs, and tool docs, with no database dependency or embedded secret.

## Product checks

- [ ] `npm run test:unit` passes the DNS normalization, TTL, CNAME, resolver, trace, delegation, DNSSEC, SOA, CAA, network-safety, and export tests.
- [ ] `npm run build` produces every page and API route.
- [ ] `npm run test:e2e` passes in desktop and mobile Chromium.
- [ ] `npm run test:live` completes all seven tools against a public test domain.
- [ ] Each result remains readable without page-level horizontal overflow.
- [ ] CSV downloads and per-section raw responses appear where the tool provides them.

## Self-hosting checks

- [ ] `docker compose build` completes without errors.
- [ ] `docker compose up -d` reaches a healthy state on port `1273`.
- [ ] `docker compose exec -T dns-tools id -u` prints `1001`, confirming the app is not running as root.
- [ ] The host can make outbound HTTPS requests and direct UDP/TCP DNS requests on port 53.
- [ ] `/api/health` returns `{"status":"ok","service":"dns-tools"}`.

## Search, privacy, and security

- [ ] A default installation returns `X-Robots-Tag: noindex, follow`, disallows crawling in `robots.txt`, and has an empty sitemap.
- [ ] Indexing is enabled only with `DNS_TOOLS_ALLOW_INDEXING=true` and a real `NEXT_PUBLIC_SITE_URL`.
- [ ] DNS API responses use `Cache-Control: no-store`.
- [ ] Cross-origin browser requests are rejected.
- [ ] Private, loopback, link-local, documentation, multicast, reserved, and other non-public direct DNS targets are rejected.
- [ ] Reverse-proxy client-IP handling and an additional public rate limit are configured before internet exposure.

## Release material

- [ ] README, API reference, OpenAPI contract, self-hosting guide, security policy, privacy notes, troubleshooting guide, contribution guide, and license are current.
- [ ] Screenshots show real results from the release build on desktop and mobile.
- [ ] No secrets, local logs, build output, dependency folders, or lookup history are included.
- [ ] The release has a supported version and a short changelog.
