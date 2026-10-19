# syntax=docker/dockerfile:1
# Build context: repository root.
ARG NODE_IMAGE=node:26.12.0-alpine3.24
ARG NGINX_IMAGE=nginx:1.30.6-alpine3.24

FROM ${NODE_IMAGE} AS base
RUN npm i -g pnpm@12.14.0 && npm cache clean --force
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@easysend/web..."

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @easysend/web build

FROM ${NGINX_IMAGE} AS runtime
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/security-headers.conf docker/proxy-headers.conf /etc/nginx/
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
