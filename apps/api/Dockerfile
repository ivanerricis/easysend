# syntax=docker/dockerfile:1
# Build context: repository root.
ARG NODE_IMAGE=node:26.12.0-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24.2

FROM ${NODE_IMAGE} AS base
RUN npm i -g pnpm@12.14.0 && npm cache clean --force
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@easysend/api..."

# The node binary ships with debug symbols: strip them. binutils stays in this stage.
FROM base AS node-stripped
RUN apk add --no-cache binutils \
 && cp /usr/local/bin/node /node \
 && strip --strip-unneeded /node \
 && /node --version

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @easysend/api build \
 && pnpm --filter @easysend/api deploy --prod /out
# Everything except the native packages (better-sqlite3, sharp, @node-rs/argon2) is bundled into
# dist/ by tsdown, so /out/node_modules holds only those and their dependencies. Drop what is not
# needed at runtime (never LICENSE files): better-sqlite3 ships prebuilt addons for every platform
# (keep only the musl ones), and the packages ship docs and typings.
RUN find /out/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/prebuilds -type f ! -name 'linuxmusl-*.node' -delete \
 && find /out/node_modules/ \( -name "*.md" -o -name "*.map" -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" \) \
      ! -iname "LICENSE*" -type f -delete

# Runtime: plain Alpine plus the node binary (no npm, npx, yarn or corepack). Same Alpine/musl
# line as the node image, so the native better-sqlite3 build matches.
FROM ${ALPINE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    DATA_DIR=/data \
    SHARED_DIR=/shared \
    UPDATE_DIR=/updates \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
RUN apk add --no-cache libstdc++ libatomic \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node \
 && mkdir -p /data /shared /updates /app && chown node:node /data /shared /updates /app
COPY --from=node-stripped /node /usr/local/bin/node
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
