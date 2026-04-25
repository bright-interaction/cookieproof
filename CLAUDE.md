# CookieProof

GDPR cookie consent platform: embeddable Web Component widget, Bun API, single-file admin dashboard (configurator).

## Test commands

| What | Command | Notes |
|---|---|---|
| Unit (vitest, happy-dom) | `bun run test` | 9 files, ~30s |
| Full E2E (Playwright) | `bun run test:e2e` | 86 tests across widget + API + configurator + round-trip. Baseline: 84 pass + 2 documented skips, ~50s. |
| Both | `bun run test:all` | Unit then E2E. |
| Slash | `/cookieproof-test` | Same as `test:e2e` with summary. |

E2E gotcha: Playwright cannot be invoked via Bun's runtime (it does not handle `.esm.preflight` transforms). Node@20 must be on PATH. Homebrew installs it keg-only at `/opt/homebrew/Cellar/node@20/<ver>/bin/`.

First-time setup on a new machine:
```
brew install node@20
./node_modules/.bin/playwright install chromium firefox
```

The weekly regression routine `cookieproof-e2e-weekly` runs the full suite every Monday 06:00 Europe/Stockholm in Anthropic's cloud.

## Bun, not npm

Always Bun. `bun install --frozen-lockfile`, `bun run <script>`. Only `bun.lock` is tracked. The project Dockerfile uses `oven/bun:1-alpine`.

## Two repos to keep in sync

This codebase lives in two places and changes must propagate to both:

1. **`automations/CookieProof/`** in the private monorepo (`code.brightinteraction.com/brightinteraction/automations`, mirrored to `github.com/bright-interaction/automations`). Primary source of truth.
2. **`github.com/brightinteraction/cookieproof`** — the public OSS repo referenced in `package.json`'s `repository.url`. Must be kept current with the monorepo's `CookieProof/` subtree, otherwise OSS users miss fixes.

After non-trivial changes, sync the OSS repo. Currently this is a manual subtree push or rsync-then-commit; automation is a TODO.

## Layout

```
src/                 widget source (TypeScript -> Rollup -> dist/cookieproof.umd.js)
api/                 Bun API server (server.ts, db.ts, schema.postgres.sql)
configurator/        single-file SPA (index.html ~11k lines, vanilla JS)
e2e/                 Playwright suites + helpers + integrated test server
tests/               vitest unit tests (happy-dom)
demo/                standalone widget demo page
ee/                  enterprise-only license tooling
integrations/        per-vendor integration bundles (GA, GTM, Meta, etc.)
wrappers/            React + Vue thin wrappers
```

See [`/Users/tom.isgren/Desktop/Hive/entities/cookieproof.md`](/Users/tom.isgren/Desktop/Hive/entities/cookieproof.md) for the architectural overview, the API endpoint catalog ([`cookieproof-api.md`](/Users/tom.isgren/Desktop/Hive/entities/cookieproof-api.md)), and widget internals ([`cookieproof-widget.md`](/Users/tom.isgren/Desktop/Hive/entities/cookieproof-widget.md)).

## Protocol quirks (verified by tests)

- `consent.method` valid enum: `accept-all | reject-all | custom | gpc | dns | do-not-sell`. Not `'banner'`.
- Auth response sets `ce_session` (httpOnly JWT, 7d) + `ce_csrf` (JS-readable). Mutating requests must echo the CSRF cookie value as `X-CSRF-Token` header.
- `PUT /api/config` without CSRF returns 401, not 403 (auth gate collapses both).
- `POST /api/settings/domains` requires a full `https://` URL; bare hostnames are rejected.
- Team endpoints (`/api/team/*`) are EE-gated. Without `COOKIEPROOF_LICENSE_KEY` they 403 with the EE error.
- `domain_configs` are org-scoped on first write; a second org cannot claim a domain already owned.
- `/api/auth/forgot-password` returns 200 for both known and unknown emails (anti-enumeration).
- The widget's `proofEndpoint` is hard-gated to `https://`. Local round-trip tests use a sendBeacon/fetch interceptor in the fixture page.
- `loader.js` hard-codes `consent.brightinteraction.com` as the API host. Cannot be exercised locally without a build flag (E2E test for this path is skipped).
