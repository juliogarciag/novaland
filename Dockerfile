# syntax=docker/dockerfile:1
# One deployable process: the built client and the world room on one port.
#
#   docker build -t novaland .
#   docker run --rm -e PORT=8080 -p 8080:8080 novaland
#
# Host-agnostic: PORT comes from the environment (the host sets it), the
# process answers GET /healthz, and the world lives in this process's memory.
# Node 24 as .node-version says; pnpm through corepack at the version pinned
# in package.json's packageManager field.

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# The manifests first, so the dependency layer is reused while only sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sim/package.json packages/sim/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/

# Build: every dependency, then the client bundle and the server bundle.
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm build

# Production dependencies of the server only. The sim is bundled into the server, so its sources are not needed here
# and the workspace link to it is dropped. (typescript comes along as a peer dependency of @colyseus/schema.)
FROM base AS production-deps
RUN pnpm install --frozen-lockfile --prod --filter @novaland/server \
 && rm -rf packages/server/node_modules/@novaland

# Run: the two bundles, the server's runtime dependencies, nothing else.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=production-deps /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT:-2567}/healthz" || exit 1
CMD ["node", "packages/server/dist/index.mjs"]
