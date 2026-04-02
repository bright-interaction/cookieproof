# CookieProof

GDPR & IMY 2026 compliant cookie consent Web Component. Shadow DOM encapsulated, framework-agnostic, under 8KB gzipped.

## Features

- **Web Component** — works in any framework (Astro, React, Vue, Angular, plain HTML)
- **Shadow DOM** — zero style conflicts with your site
- **IMY 2026 compliant by default** — symmetric buttons, no dark patterns
- **Script-gate engine** — blocks scripts, iframes, and tracking pixels until consent
- **Google Consent Mode V2** — built-in gtag integration
- **i18n** — English and Swedish included, fully customisable
- **10 integration presets** — GA4, GTM, Meta Pixel, LinkedIn, TikTok, Umami, Plausible, Matomo, HubSpot, Hotjar
- **Multi-tenant dashboard** — manage multiple domains with team collaboration
- **Consent proof ledger** — immutable records with PDF export via Gotenberg
- **Agency mode** — manage client organisations with white-label branding
- **Billing integration** — Mollie payments with subscription lifecycle
- **Automated alerts** — health scores, scheduled reports, email notifications
- **Cookie scanner** — automatic third-party cookie detection
- **7.5KB gzipped** core bundle

## Quick Start

### CDN / Script Tag

```html
<script src="https://consent.brightinteraction.com/loader.js"
        data-domain="yourdomain.com"></script>
```

The loader script fetches your published configuration and initialises the banner automatically.

### npm

```bash
npm install cookieproof
```

```javascript
import 'cookieproof';

const cc = document.querySelector('cookie-consent');
cc.configure({
  language: 'sv',
  gcmEnabled: true,
});
```

## Blocking Scripts

Mark scripts you want to gate behind consent:

```html
<!-- Analytics (blocked until user consents to 'analytics') -->
<script type="text/plain" data-consent="analytics"
        src="https://www.googletagmanager.com/gtag/js?id=G-XXXXX">
</script>

<!-- Marketing (blocked until user consents to 'marketing') -->
<script type="text/plain" data-consent="marketing">
  fbq('init', '1234567890');
  fbq('track', 'PageView');
</script>

<!-- Iframes -->
<iframe data-consent="marketing"
        data-src="https://www.youtube.com/embed/dQw4w9WgXcQ"
        style="display:none;">
</iframe>
```

When the user grants consent for a category, the engine swaps `type="text/plain"` to `type="text/javascript"` and the scripts execute.

## Configuration

```javascript
cc.configure({
  // Categories (defaults: necessary, analytics, marketing, preferences)
  categories: [
    { id: 'necessary', required: true, enabled: true },
    { id: 'analytics', required: false, enabled: false },
    { id: 'marketing', required: false, enabled: false },
    { id: 'preferences', required: false, enabled: false },
  ],

  // UI
  position: 'bottom',         // 'bottom' | 'top' | 'center'
  theme: 'auto',              // 'light' | 'dark' | 'auto'
  floatingTrigger: 'left',    // true | false | 'left' | 'right'

  // i18n
  language: 'sv',             // 'en' | 'sv' | auto-detect

  // Storage
  storage: 'localStorage',    // 'localStorage' | 'cookie'
  cookieExpiry: 365,           // days

  // Versioning (bump to re-prompt users)
  revision: 1,

  // Google Consent Mode V2
  gcmEnabled: true,

  // Callbacks
  onAccept: (consent) => console.log('Accepted:', consent),
  onReject: (consent) => console.log('Rejected:', consent),
  onChange: (consent, changed) => console.log('Changed:', changed),
});
```

## Client API

```javascript
const cc = document.querySelector('cookie-consent');

// Actions
cc.acceptAll();
cc.rejectAll();
cc.acceptCategory('analytics');
cc.rejectCategory('marketing');

// State
cc.getConsent();              // ConsentRecord | null
cc.hasConsent('analytics');   // boolean

// UI
cc.showBanner();
cc.showPreferences();
cc.hide();
cc.reset();                   // Clear consent, show banner

// Events
const unsub = cc.on('consent:update', (detail) => {
  console.log(detail.consent);
  console.log(detail.changed);
});
unsub(); // unsubscribe
```

### Events

| Event | When |
|-------|------|
| `consent:init` | Component initialised, consent state loaded |
| `consent:update` | Any consent change |
| `consent:accept-all` | User clicked Accept All |
| `consent:reject-all` | User clicked Reject All |
| `consent:category:analytics` | Analytics category changed |

## Server API

### Authentication

The API supports two authentication methods:

- **Session cookies** — The configurator dashboard uses httpOnly cookies with CSRF double-submit tokens. Login via `POST /api/auth/login`.
- **API key** — Set `COOKIEPROOF_API_KEY` and pass as `Authorization: Bearer <key>`. Used for headless/CI integrations.

Public endpoints (config lookup, proof recording, health check) require no authentication.

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config/:domain` | Fetch published banner config for a domain |
| `POST` | `/api/proof` | Record a consent proof (called by the widget) |
| `GET` | `/api/health` | Health check (database + Gotenberg status) |

### Consent Proof Endpoints (Auth Required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/proof` | List proofs with pagination and filters |
| `GET` | `/api/proof/:id` | Get a single proof by UUID |
| `GET` | `/api/proof/stats` | Aggregate stats + daily breakdown |
| `GET` | `/api/proof/export` | CSV export of matching proofs |
| `DELETE` | `/api/proof` | Purge proofs older than a timestamp |

### Query Parameters

- `domain` — filter by domain (exact match)
- `method` — filter by consent method (`accept-all`, `reject-all`, `custom`, `gpc`)
- `from` / `to` — timestamp range (milliseconds since epoch)
- `limit` / `offset` — pagination (max 500)

### Webhook

Set `WEBHOOK_URL` to receive a POST notification whenever a new consent proof is recorded:

```json
{
  "event": "consent.recorded",
  "data": { "id": "...", "domain": "...", "method": "accept-all", "categories": {} },
  "timestamp": 1234567890
}
```

Set `WEBHOOK_SECRET` to include an `X-Webhook-Secret` header for verification.

## Deployment

### Docker Compose

```bash
git clone <repo-url>
cd CookieProof
cp .env.example .env  # configure all required variables
docker compose up -d --build
```

### Environment Variables

See `.env.example` for a complete reference. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `COOKIEPROOF_API_KEY` | _(empty)_ | API key for Bearer token authentication |
| `ALLOWED_ORIGINS` | _(empty)_ | Comma-separated allowed CORS origins |
| `RETENTION_DAYS` | `1095` (3 years) | Auto-purge proofs older than this |
| `WEBHOOK_URL` | _(empty)_ | URL to POST consent events to |
| `WEBHOOK_SECRET` | _(empty)_ | Shared secret for webhook verification |
| `RESEND_API_KEY` | _(empty)_ | Resend API key (preferred email provider) |
| `SMTP_HOST` | _(empty)_ | SMTP server for email (fallback) |
| `ADMIN_EMAIL` | _(empty)_ | Super admin email for bootstrap |
| `MOLLIE_API_KEY` | _(empty)_ | Mollie payment API key |
| `MOLLIE_WEBHOOK_URL` | _(empty)_ | Mollie webhook callback URL (HTTPS) |
| `MOLLIE_REDIRECT_URL` | _(empty)_ | Redirect after Mollie checkout (HTTPS) |
| `GOTENBERG_URL` | `http://gotenberg:3000` | Gotenberg PDF service URL |

### Architecture

```
┌─────────────┐    ┌──────────┐    ┌────────────┐    ┌────────────┐
│  Browser     │───▶│  nginx   │───▶│  Bun API   │───▶│ Gotenberg  │
│  <cookie-    │    │  :8080   │    │  :3100     │    │  :3000     │
│  consent>    │    │  /dist/  │    │  /api/*    │    │  PDF gen   │
│              │    │  /config │    │  SQLite    │    │            │
└─────────────┘    └──────────┘    └────────────┘    └────────────┘
                   │  /loader.js          │
                   │  /configurator/      │
                   └──────────────────────┘
```

Services are deployed via Docker Compose with:
- Read-only filesystems and minimal tmpfs mounts
- All capabilities dropped (`cap_drop: ALL`)
- `no-new-privileges` security option
- Memory and CPU resource limits
- Non-root containers (nginx-unprivileged, su-exec user drop)

## Integration Presets

```javascript
import { ga4, facebookPixel } from 'cookieproof/integrations';

cc.configure({
  categories: [
    { id: 'necessary', required: true, enabled: true },
    {
      id: 'analytics',
      services: [ga4('G-XXXXX').service],
    },
    {
      id: 'marketing',
      services: [facebookPixel('1234567890').service],
    },
  ],
  gcmEnabled: true,
});
```

Available presets: `ga4`, `gtm`, `facebookPixel`, `linkedinInsight`, `tiktokPixel`, `umami`, `plausible`, `matomo`, `hubspot`, `hotjar`.

## Theming

CSS custom properties pierce through Shadow DOM:

```css
cookie-consent {
  --cc-bg: #ffffff;
  --cc-text: #1a1a1a;
  --cc-text-secondary: #6b7280;
  --cc-border: #e5e7eb;
  --cc-btn-primary-bg: #0d9488;
  --cc-btn-primary-text: #ffffff;
  --cc-btn-secondary-bg: #e5e7eb;
  --cc-btn-secondary-text: #374151;
  --cc-toggle-on: #0d9488;
  --cc-radius: 12px;
  --cc-font: system-ui, sans-serif;
  --cc-z-index: 10000;
  --cc-max-width: 540px;
}
```

`::part()` selectors are exposed for deeper customisation: `banner`, `preferences`, `trigger`, `btn`, `btn-accept`, `btn-reject`, `btn-settings`, `category`, `category-toggle`.

## IMY 2026 Compliance

These are enforced by default — you don't need to configure anything:

- Reject All button on the first layer with equal visual prominence to Accept All
- No pre-ticked category checkboxes
- Persistent floating trigger for changing consent after the banner is dismissed
- Button order: Reject / Settings / Accept (no positional bias)
- Console warning if you override compliance defaults

## Google Consent Mode V2

When `gcmEnabled: true`, the engine automatically:

1. Calls `gtag('consent', 'default', { all signals: 'denied' })` on page load
2. Updates signals when the user makes a choice:
   - `analytics` category → `analytics_storage`
   - `marketing` category → `ad_storage`, `ad_user_data`, `ad_personalization`
   - `preferences` category → `functionality_storage`, `personalization_storage`

You can override the mapping with `gcmMapping`.

## Global Privacy Control (GPC)

When `respectGPC` is `true` (default) and `navigator.globalPrivacyControl === true`:

- Non-essential categories are automatically rejected
- No banner is shown (the floating trigger appears for manual override)
- A `consent:gpc` event is emitted
- The proof record has `method: 'gpc'`

## Geo-Conditional Display

Set `geoEndpoint` to skip the consent banner for visitors outside regulated regions:

```javascript
cc.configure({
  geoEndpoint: 'https://your-api.com/geo'
});
```

The endpoint must return JSON: `{ "requiresConsent": true | false }`. HTTPS is required. If the endpoint fails or is unreachable, the banner is shown (fail-safe).

## License

MIT
