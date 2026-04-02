#!/bin/sh
# Fix ownership of mounted /data volume (may be root-owned from prior versions)
if [ "$(id -u)" = "0" ]; then
  chown -R appuser:appgroup /data 2>/dev/null || true
  exec su-exec appuser bun run server.ts
else
  exec bun run server.ts
fi
