# syntax=docker/dockerfile:1
# The official image is distroless (no shell) and the binary is static, so we copy
# the binary into Alpine to get a POSIX shell for the wait-for-token entrypoint.
# Build context: repository root.
FROM cloudflare/cloudflared:2026.10.3 AS cf

FROM alpine:3.24.3
RUN adduser -D -u 1000 -h /home/easysend easysend
COPY --from=cf /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --chmod=0755 docker/cloudflared/entrypoint.sh /entrypoint.sh
ENV SHARED_DIR=/shared
USER 1000:1000
ENTRYPOINT ["/entrypoint.sh"]
