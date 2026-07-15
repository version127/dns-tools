# Troubleshooting

## The page loads but direct checks time out

Confirm that the host can send both UDP and TCP traffic to destination port 53. Public resolver lookup can still work over HTTPS when direct DNS is blocked.

## Every visitor shares one rate limit

The application could not identify clients separately. Put it behind a trusted reverse proxy that overwrites and forwards a real client address. The limiter remains per process.

## Docker says the application is unhealthy

Check `docker compose logs dns-tools` and open `http://localhost:1273/api/health`. The health route only checks the Next.js process, so an unhealthy result usually means the server did not start or the configured port changed.

## DNS results differ between sources

That is often the reason to use these tools. Public resolvers can have different remaining cache lifetimes, and location-aware address responses can legitimately differ. Compare the actual owner names, values, aliases, and authoritative response before calling one source broken.

## A favicon is missing

Favicons are optional. The browser tries the submitted website's `/favicon.ico` without a server proxy and removes the image when it cannot load. Service names such as `_dmarc.example.com` do not trigger the request.
