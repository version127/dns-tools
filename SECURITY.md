# Security

DNS Tools sends network requests on behalf of a visitor, so input validation and request bounds are part of the product rather than optional hardening.

Please report security problems privately to `security@version127.com`. Include the affected route, a minimal reproduction, and the impact. Do not include real secrets or private DNS names.

The current security boundary includes fixed public DNS-over-HTTPS endpoints, public-address checks before direct DNS connections, matching response IDs, bounded response sizes, timeouts, referral and alias limits, small request bodies, same-origin browser requests, and weighted in-memory rate limits.

The in-memory limiter is per Node process. A public multi-instance deployment should place a trusted reverse proxy or shared rate limiter in front of the application. The proxy must overwrite forwarded client-IP headers instead of appending values supplied by the visitor.

Only supported releases receive security fixes. A release policy will be added before the first public tag.
