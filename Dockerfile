# Dockerfile for the Glama registry (glama.ai) — builds and runs the server
# locally over stdio (src/cli.ts → dist/cli.js). Glama's harness wraps the
# stdio command with mcp-proxy to reach it over HTTP/SSE.
#
# The stdio runtime is the SAME server as the hosted Cloudflare Worker: same
# tools, validations, limits and provenance block; it talks directly to the
# official ILOSTAT SDMX API. Without Cloudflare bindings it uses an in-process
# cache instead of KV and downloads the search catalogue from the official
# endpoint on first search instead of reading D1.

FROM node:22-bookworm-slim

WORKDIR /app

# Dependency layer (cacheable). devDependencies are needed for `npm run build`.
COPY package.json package-lock.json ./
RUN npm ci

# Sources + build (tsc -p tsconfig.build.json → dist/).
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/cli.js"]
