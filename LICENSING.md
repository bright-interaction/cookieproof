# Licensing and open core

CookieProof is open core (fair-code).

## Core (this repository): CookieProof Sustainable Use License

Everything in this repository is licensed under the CookieProof Sustainable Use
License (see [LICENSE](LICENSE)). That is the whole consent platform: the
Shadow-DOM banner widget with script gating and Google Consent Mode V2, the Bun
API recording consent proofs, the dashboard/configurator, the per-vendor
integration bundles, the React/Vue wrappers, the scanner, webhooks, alerts, and
the PDF reports.

Nothing here is crippled. A self-hosted instance serves unlimited domains and
Visitors. Team and agency endpoints are gated by a license key
(`COOKIEPROOF_LICENSE_KEY`, Ed25519-signed; only the Licensor can mint one),
which is the enterprise tier; everything else runs without any key.

This is a [fair-code](https://faircode.io) license, not an OSI "open source"
license. The one limit: you may not resell CookieProof or run it as a hosted
consent-management service for third parties. Self-hosting, internal commercial
use, serving your visitors, and running consent for your own clients' sites (as
an agency) are all expressly fine.

Versions published on or before 2026-04-25 were MIT; copies obtained under MIT
remain MIT. Everything after is under the Sustainable Use License.

## Enterprise overlay (not in this repository)

The `ee/` license tooling (key minting) and the commercial license terms are
held back from the public mirror. The public tree carries only the public
verification key, so a self-hosted instance can verify a purchased license but
nobody can issue one.

What you cannot get from this repo is not engine code, it is standing:

- the hosted EU service at consent.example.com (managed, backed up,
  EU data residency);
- enterprise license keys for the team/agency tier;
- a production payment provider account for the billing endpoints;
- support and SLAs.

## Commercial license

If you want to do something the Sustainable Use License does not permit (for
example, offering CookieProof as a hosted service to third parties, or
white-labeling it in a closed product), a commercial license is available at
licensing@brightinteraction.com.
