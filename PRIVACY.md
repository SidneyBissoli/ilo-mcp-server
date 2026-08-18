# Privacy Policy — ilo-mcp-server

**Effective date:** 2026-08-07 · **Service:** `https://ilo.sidneybissoli.com` (remote MCP server)

This service provides read-only access to public labour statistics from ILOSTAT
(International Labour Organization). It requires no account, no login, and no
API key.

## What we collect

- **Nothing that identifies you.** The server does not log query content, tool
  parameters, request bodies, or any user data.
- **Aggregate usage metrics only:** event type (request, tool call, tool error,
  rate-limited), tool or route name, and daily counts. These aggregates contain
  no IP addresses and no query content, and are publicly visible at `/metrics`.
- **Rate limiting** uses the client IP in ephemeral in-process memory only
  (token bucket). It is never persisted or logged by the application.

## Infrastructure

The service runs on Cloudflare Workers. Cloudflare, as hosting provider, may
process connection metadata (including IP addresses) per its own
[privacy policy](https://www.cloudflare.com/privacypolicy/).

## Upstream requests

Your queries are translated into requests to the public ILOSTAT SDMX API
(`sdmx.ilo.org`). No user-identifying information is forwarded upstream.

## Data license

Statistical data returned by this service comes from ILOSTAT and is licensed
CC BY 4.0. Every response carries a provenance block (source URL, data vintage,
retrieval date, license). This service is not endorsed by the ILO.

## Contact

Sidney da S. P. Bissoli — sbissoli76@gmail.com
