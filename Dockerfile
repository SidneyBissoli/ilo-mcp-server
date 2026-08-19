# Dockerfile for the Glama registry (glama.ai) release/build test.
#
# This server is remote-only: it runs on Cloudflare Workers and is served at
# https://ilo.sidneybissoli.com/mcp. There is no local stdio runtime — the ILO
# gateway rejects Node's fetch, and the catalogue lives in D1 — so the container
# is a thin, faithful bridge to the hosted endpoint:
#
#   mcp-proxy (HTTP/SSE for the Glama tester) → mcp-remote (stdio) → production
#
# The tools Glama sees are therefore the real production tools. Both bridge
# packages are installed at build time (pinned) so nothing is fetched from npm at
# container start. Verified locally end-to-end (initialize, tools/list, tools/call).

FROM node:22-bookworm-slim

RUN npm install -g mcp-proxy@6.4.3 mcp-remote@0.1.38

# The bridge has nothing to build; the sources are here only for reference.
WORKDIR /app
COPY package.json README.md LICENSE.md ./

CMD ["mcp-proxy", "--", "mcp-remote", "https://ilo.sidneybissoli.com/mcp"]
