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

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @easysend/api build \
 && pnpm --filter @easysend/api deploy --prod /out

# Runtime: plain Alpine plus the node binary (no npm, npx, yarn or corepack). Same Alpine/musl
# line as the node image, so the native better-sqlite3 build matches.
FROM ${ALPINE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    DATA_DIR=/data \
    SHARED_DIR=/shared \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
RUN apk add --no-cache libstdc++ libatomic \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node \
 && mkdir -p /data /shared /app && chown node:node /data /shared /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
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
