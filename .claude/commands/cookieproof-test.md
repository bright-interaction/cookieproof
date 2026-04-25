---
description: Run the full CookieProof Playwright E2E suite (widget + API + dashboard + round-trip) and summarize.
---

Run the full CookieProof E2E suite and report the result.

## Steps

1. From the CookieProof project root:
   - If `node` is not on PATH, prepend the homebrew node@20 binary:
     `export PATH="/opt/homebrew/Cellar/node@20/$(ls /opt/homebrew/Cellar/node@20 | head -1)/bin:$PATH"`
   - Verify deps: if `node_modules/` is missing, run `bun install --frozen-lockfile`.
   - Verify Playwright browsers (idempotent): `./node_modules/.bin/playwright install chromium firefox`.
2. Build the widget if `dist/` is older than `src/`: `bun run build`.
3. Run the suite: `./node_modules/.bin/playwright test --reporter=list`.

## Baseline

86 tests across 5 projects (api, widget-chromium, widget-firefox, configurator, integration). Expected: **84 passed, 2 skipped, ~50s**. The 2 skips are intentional and documented in the spec files.

## Reporting

- All green: one line, e.g. `84/84 green, 2 documented skips, 52s`.
- Any failure or unexpected count: list each failing test (project + title + file:line + first 5 lines of error), the path to `playwright-report/index.html`, and the current commit sha. Do NOT auto-fix; report only.
