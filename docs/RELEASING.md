# Releasing CookieProof as a public fair-code repo

CookieProof lives in the private `bright-interaction/automations` monorepo under
`CookieProof/`. The public release is a mirror of that subtree at
`github.com/bright-interaction/cookieproof`.

CookieProof is open core (see [../LICENSING.md](../LICENSING.md)): the mirror
carries the whole `CookieProof/` tree under the CookieProof Sustainable Use
License. The split script strips the enterprise license tooling (`ee/`, which
holds the key-minting tool; the public tree keeps only the verification path),
the estate deploy compose (public self-hosters use `deploy/docker-compose.yml`),
and internal agent files (`CLAUDE.md`, `.claude/`), then redacts internal infra
hostnames from history (`scripts/split-public-repo.sh`).

History note: the public repo originally held two hand-rsynced MIT commits
(last 2026-04-25) that included internal files. The 2026-07-18 SUL publish
replaced that history once with the filtered subtree mirror (a deliberate,
documented force push; 0 forks / 0 stars at the time). From then on the split
is deterministic, so every re-publish fast-forwards; if the push refuses,
someone rewrote history and you must reconcile deliberately, never force-push
casually.

Publishing is an outward step, so it is a deliberate operator action, not part
of `git psync`. It requires `git-filter-repo`, `gitleaks`, and `bun` on PATH.

## Publish

1. Dry run first (safe, no push): `./scripts/split-public-repo.sh`. It
   subtree-splits, strips/redacts, build-checks (bun install + build +
   typecheck + unit tests) and gitleaks-scans the filtered tree, then prints
   what it WOULD push. Get this green before step 2.
2. Mirror and push: `./scripts/split-public-repo.sh --push`.
3. Verify the mirror builds standalone:
   ```
   git clone git@github.com:bright-interaction/cookieproof.git /tmp/cp-check
   cd /tmp/cp-check && bun install --frozen-lockfile && bun run build && bun run test
   ```

## Cut a version

```
git clone --depth 1 git@github.com:bright-interaction/cookieproof.git /tmp/cp-tag
cd /tmp/cp-tag && git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --repo bright-interaction/cookieproof --generate-notes
```
