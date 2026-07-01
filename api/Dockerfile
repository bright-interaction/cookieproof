FROM oven/bun:1-alpine

# Create a non-root user and group, install su-exec for privilege dropping
RUN apk add --no-cache su-exec && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Flare error reporting SDK, pinned to the version in the repo root bun.lock.
# Must be baked into the image: the container runs with a read-only root
# filesystem, so Bun's runtime auto-install cannot fetch it on boot.
RUN bun add --exact @sentry/bun@10.63.0

COPY server.ts sharedsecret.ts entrypoint.sh ./
COPY scanner/ ./scanner/
RUN chmod +x entrypoint.sh

# Create the data volume mount point and make it writable by appuser
RUN mkdir -p /data && chown appuser:appgroup /data

VOLUME /data
EXPOSE 3100

# Health check – hit the /api/health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3100/api/health || exit 1

# Entrypoint fixes /data ownership on mount, then drops to appuser via su-exec
ENTRYPOINT ["./entrypoint.sh"]
