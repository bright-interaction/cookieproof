FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src/ src/
COPY integrations/ integrations/
COPY configurator/loader.js configurator/loader.js
COPY rollup.config.mjs tsconfig.json ./
RUN bun run build && \
    echo -n "sha384-$(cat dist/cookieproof.umd.js | openssl dgst -sha384 -binary | openssl base64 -A)" > dist/cookieproof.sri

# Use unprivileged nginx image for security
FROM nginxinc/nginx-unprivileged:alpine

# Copy nginx config (adjusted for non-root)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static files
COPY --chown=nginx:nginx configurator/ /usr/share/nginx/html/configurator/
COPY --from=build --chown=nginx:nginx /app/configurator/loader.min.js /usr/share/nginx/html/configurator/loader.min.js
COPY --chown=nginx:nginx demo/ /usr/share/nginx/html/demo/
COPY --from=build --chown=nginx:nginx /app/dist/ /usr/share/nginx/html/dist/

# nginx-unprivileged listens on 8080 by default
EXPOSE 8080
