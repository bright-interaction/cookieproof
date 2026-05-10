FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts
COPY src/ src/
COPY integrations/ integrations/
COPY configurator/loader.js configurator/loader.js
COPY rollup.config.mjs tsconfig.json ./
RUN bun run build && \
    echo -n "sha384-$(cat dist/cookieproof.umd.js | openssl dgst -sha384 -binary | openssl base64 -A)" > dist/cookieproof.sri

# Use unprivileged nginx image for security
FROM nginxinc/nginx-unprivileged:alpine

# Pull current Alpine security patches the upstream image hasn't
# rebuilt with yet. Trivy with severity=CRITICAL + ignore-unfixed
# flags the stale base every run otherwise. nginx-unprivileged sets
# USER nginx in the base; switch to root for the upgrade then back.
USER root
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*
USER nginx

# Copy nginx config (adjusted for non-root)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static files
COPY --chown=nginx:nginx configurator/ /usr/share/nginx/html/configurator/
COPY --from=build --chown=nginx:nginx /app/configurator/loader.min.js /usr/share/nginx/html/configurator/loader.min.js
COPY --chown=nginx:nginx demo/ /usr/share/nginx/html/demo/
COPY --from=build --chown=nginx:nginx /app/dist/ /usr/share/nginx/html/dist/

# nginx-unprivileged listens on 8080 by default
EXPOSE 8080
