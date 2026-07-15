# Launch acceptance report — 2026-07-15

This report records the acceptance run for the local `1.0.0` release candidate. It does not mean the standalone repository has been created or pushed to GitHub.

## Result

The release candidate is ready for repository publication. All seven tools build, render, and return live DNS results from the production build. The Docker service is healthy on port `1273` and runs as a non-root user.

## Reproducible install

- `npm ci` completed from `package-lock.json`.
- `npm audit --json` reported zero known vulnerabilities across production and development dependencies.
- `npm run test:repo` found all seven pages, APIs, and tool documents, with no database dependency or embedded secret.

## Product checks

- `npm run test:unit` passed the DNS parsing, normalization, transport, security, presentation, and export tests.
- `npm run build` produced all seven pages, all seven DNS API routes, the health route, robots file, and sitemap.
- `npm run test:e2e` passed the desktop and mobile browser suite. One desktop-only mobile duplicate is intentionally skipped.
- Live checks against `cloudflare.com` returned HTTP 200 from all seven tools.
- Browser tests found no page-level horizontal overflow and verified raw responses and downloads where each tool provides them.
- Nine release screenshots show the hub, mobile layout, and completed results from every tool.

## Self-hosting checks

- `docker compose build` completed with the pinned Node 24 Alpine image.
- `docker compose up -d` reached a healthy state on port `1273`.
- The application runs as UID `1001` inside the container.
- Live trace, delegation, SOA, and change checks confirmed outbound UDP and TCP DNS access. Resolver and DNSSEC checks confirmed outbound HTTPS access.
- `/api/health` returned `{"status":"ok","service":"dns-tools"}`.

## Search, privacy, and security

- A default installation sends `X-Robots-Tag: noindex, follow`, disallows crawling, and exposes no indexable tool sitemap entries.
- Browser coverage verifies the explicit indexing opt-in behavior.
- DNS API responses use `Cache-Control: no-store`.
- Cross-origin browser requests are rejected.
- Direct DNS target validation rejects non-public address ranges.
- The self-hosting and security guides require a trusted reverse proxy and a second rate limit before public exposure.

## Release material

- README, API reference, OpenAPI contract, self-hosting guide, security policy, privacy notes, troubleshooting guide, contribution guide, MIT license, and changelog are present.
- Generated build output, dependencies, local environment files, test artifacts, and lookup history are excluded from the tracked repository surface.
- The release version is `1.0.0`.

