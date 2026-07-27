#!/usr/bin/env bash
# Every check CI runs, in one script you can also run yourself:
#
#   bash scripts/ci.sh
#
# Run it before opening a pull request and CI will not tell you anything new.
#
# WHY THE LOGIC LIVES HERE AND NOT IN .github/workflows/ci.yml
#
# Two reasons, and the second is not obvious.
#
# 1. A contributor can run it. Checks that only exist inside a workflow file are
#    checks you cannot reproduce locally, so you discover them after pushing.
#
# 2. It keeps .github/workflows/ci.yml STABLE, which is what makes automated
#    publishing possible at all. This repository is a filtered mirror of a private
#    monorepo, published by scripts/split-public-repo.sh over a repository deploy
#    key. GitHub does not allow a deploy key (or an OAuth token without the
#    `workflow` scope) to create or update anything under .github/workflows/. So a
#    check that lived in the workflow file would break the publish at the FINAL
#    push, after every gate had already passed, with a raw git error that reads
#    like a mystery. With the steps in this script, changing a check touches
#    scripts/ci.sh (an ordinary file the deploy key may write) and the workflow
#    file stays untouched, so the publish goes through.
#
# The consequence to remember: editing .github/workflows/ci.yml is now a rare,
# deliberate act (an action version bump, a trigger change) that needs a push from
# a credential with the `workflow` scope. Editing THIS file needs nothing special.
#
# WHAT IS DELIBERATELY NOT HERE
#
# The Playwright suite (`bun run test:e2e`, 86 tests over the widget, the API, the
# configurator and the round trip between them). It boots two servers and drives
# real Chromium and Firefox, and Playwright cannot be launched by Bun's runtime at
# all, so it needs Node on PATH as well. That is a different shape of job from a
# per-pull-request gate, and pretending otherwise would mean a gate that is red or
# skipped most of the time. It runs on a weekly schedule instead. If you touch the
# API, the configurator or the widget's DOM, run it locally before you push.
set -uo pipefail

# Works in both places this file exists: the published mirror (where the product is
# the repository root) and the monorepo subdirectory it is cut from. Resolving
# against the script's own location rather than the working directory means neither
# `bash scripts/ci.sh` nor an absolute path from somewhere else can get it wrong.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
[ -f package.json ] || { echo "error: no package.json next to scripts/; this script must stay in <product>/scripts/" >&2; exit 1; }

FAILED=()
SKIPPED=()
# Exit code 99 means "this check did not run". It is distinct from pass and from
# fail on purpose: a skipped security scan that prints ok is worse than no scan at
# all, because it looks like evidence.
step() {
  local name="$1" rc; shift
  printf '\n=== %s ===\n' "$name"
  "$@"; rc=$?
  case "$rc" in
    0)  printf 'ok: %s\n' "$name" ;;
    99) printf 'SKIPPED: %s\n' "$name"; SKIPPED+=("$name") ;;
    *)  printf 'FAIL: %s\n' "$name" >&2; FAILED+=("$name") ;;
  esac
}

# Are we in the published mirror, or in the private monorepo the mirror is cut from?
# ee/ holds the enterprise licence tooling (the key-minting tool; the API keeps only
# the public verification path) and is stripped from every published commit, so its
# presence is a reliable marker. The secret scan below has to mean different things
# in the two places, and getting that wrong makes it either useless upstream or
# toothless downstream.
IN_MIRROR=1
[ -d ee ] && IN_MIRROR=0

# Bun is the package manager for this project, always. A stray npm or yarn lockfile
# is not a style question: two lockfiles resolve to two different dependency trees,
# so whichever one CI reads stops describing what anyone else installed. Drive-by
# contributors reach for `npm install` by habit, which is exactly how one appears.
package_manager() {
  local strays=""
  for f in package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml; do
    [ -e "$f" ] && strays="$strays $f"
  done
  if [ -n "$strays" ]; then
    echo "Delete these and use Bun instead:$strays" >&2
    echo "  rm$strays && bun install" >&2
    return 1
  fi
  [ -f bun.lock ] || { echo "bun.lock is missing; run 'bun install' and commit it" >&2; return 1; }
  echo "bun.lock is the only lockfile"
}

# --frozen-lockfile, not a plain install: a plain install silently rewrites bun.lock
# to match whatever package.json now says, so CI would install a tree nobody
# reviewed and still report green. This fails instead, which is the whole point.
deps() {
  bun install --frozen-lockfile
}

# tsc --noEmit over src/, integrations/ AND wrappers/ (tsconfig.json "include"
# decides; keep them all listed there). wrappers/ matters more than its size
# suggests: package.json's "exports" map points ./react and ./vue straight at
# wrappers/react.tsx and wrappers/vue.ts, so consumers compile that source
# themselves. A type error there is an error in somebody else's build, not ours.
# React and Vue are optional peer dependencies for a consumer but hard dev
# dependencies here, precisely so this gate can see them.
typecheck() {
  bun run typecheck
}

# RUN the tests, do not merely compile them. `vitest run` executes; the label says
# run because that is what happens. A suite that only compiles reports the same
# cheerful green whether it contains 244 assertions or none, and estate history says
# that misreading survives for months.
unit_tests() {
  bun run test
}

# The real Rollup build: 19 bundles (core, embed, the loader, and one pair per
# vendor integration) plus the .d.ts emit. Slow, because @rollup/plugin-typescript
# builds a fresh TypeScript program for every one of them. It is still the only
# check that proves what actually ships is buildable.
build() {
  bun run build
}

# The widget is a third-party script on other people's pages, so its transfer size
# is a product constraint, not a nicety. scripts/check-size.mjs holds the budget
# (25KB gzip) and exits non-zero over it. Reads dist/, so it needs the build above.
bundle_size() {
  if [ ! -f dist/cookieproof.esm.js ]; then
    echo "not run: dist/cookieproof.esm.js is missing (the build gate above did not produce it)"
    return 99
  fi
  bun scripts/check-size.mjs
}

# gitleaks is fetched on demand, because it is a single static binary and asking
# every contributor to install one by hand is how a scan quietly stops running.
# Pinned rather than "latest" so a new upstream ruleset cannot turn an unrelated
# pull request red without anyone choosing that. Set COOKIEPROOF_CI_SKIP_SCANNERS=1
# to skip it when offline; it will say so rather than pass quietly.
GITLEAKS_VERSION=8.30.1
GITLEAKS_BIN=""
ensure_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then GITLEAKS_BIN=gitleaks; return 0; fi
  local os arch cache url
  case "$(uname -s)" in
    Linux)  os=linux ;;
    Darwin) os=darwin ;;
    *) echo "no gitleaks build for $(uname -s)" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "no gitleaks build for $(uname -m)" >&2; return 1 ;;
  esac
  cache="${TMPDIR:-/tmp}/cookieproof-ci-gitleaks-${GITLEAKS_VERSION}"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz"
  if [ ! -x "$cache/gitleaks" ]; then
    mkdir -p "$cache" || return 1
    curl -fsSL "$url" | tar -xzf - -C "$cache" gitleaks
  fi
  # Test the artifact, never the pipeline's exit status: `producer | consumer` can
  # report success on a truncated download, and a half-extracted binary that never
  # runs would be reported as a passing scan.
  [ -x "$cache/gitleaks" ] || { echo "could not download gitleaks from $url" >&2; return 1; }
  GITLEAKS_BIN="$cache/gitleaks"
}

# .gitleaks.toml extends the default ruleset and allowlists the obvious change-me
# markers used in .env.example, so a real credential is still caught.
secret_scan() {
  if [ "${COOKIEPROOF_CI_SKIP_SCANNERS:-0}" = "1" ]; then
    echo "not run: COOKIEPROOF_CI_SKIP_SCANNERS=1"
    return 99
  fi
  ensure_gitleaks || return 99
  if [ "$IN_MIRROR" = "1" ]; then
    # Every commit here is this project's, so the full history is exactly the right
    # scope, and this is the last gate before a credential becomes world-readable.
    "$GITLEAKS_BIN" detect --source . --config .gitleaks.toml --no-banner --redact
  else
    # Upstream the history belongs to a whole monorepo of unrelated projects, so a
    # full scan returns hundreds of findings that have nothing to do with CookieProof
    # and would train everyone to ignore the check. The working tree is what matters
    # here; scripts/split-public-repo.sh scans the real filtered payload's full
    # history separately, before it pushes anything.
    "$GITLEAKS_BIN" detect --source . --no-git --config .gitleaks.toml --no-banner --redact
  fi
}

# Cheap gates first, so an obvious mistake comes back in seconds instead of after
# the build. Nothing stops at the first failure: the summary reports all of them.
step "package manager"                              package_manager
step "dependencies install from the committed lockfile" deps
step "typecheck (src, integrations, wrappers)"      typecheck
step "unit tests (vitest, executed)"                unit_tests
step "build (rollup, all bundles + .d.ts)"          build
step "bundle size budget"                           bundle_size
if [ "$IN_MIRROR" = "1" ]; then
  step "secret scan (full history)"                 secret_scan
else
  step "secret scan (working tree; the publish pipeline scans the filtered history)" secret_scan
fi

printf '\n'
if [ ${#SKIPPED[@]} -ne 0 ]; then
  printf 'ci: %d check(s) DID NOT RUN: %s\n' "${#SKIPPED[@]}" "${SKIPPED[*]}" >&2
fi
if [ ${#FAILED[@]} -ne 0 ]; then
  # Report EVERY failure, not just the first. A run that stops at the first problem
  # costs a full round trip per issue.
  printf 'ci: %d check(s) failed: %s\n' "${#FAILED[@]}" "${FAILED[*]}" >&2
  exit 1
fi
if [ ${#SKIPPED[@]} -ne 0 ]; then
  echo "ci: every check that RAN passed, but some did not run (see above)"
  exit 0
fi
echo "ci: all checks passed"
