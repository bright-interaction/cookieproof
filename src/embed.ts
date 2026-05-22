/**
 * Embed entry: single-bundle distribution that reads config from
 * `window.__CCB__` instead of fetching it from a remote API.
 *
 * Used by Atomic Site to ship the widget as a same-origin asset.
 * Standalone customers continue to use loader.js + remote /api/config.
 *
 * The widget itself (`<cookie-consent>` custom element + ConsentManager +
 * ScriptGate + UI) is unchanged. This file is a small loader-equivalent that
 *
 *   1. Auto-registers the custom element by importing ./index
 *   2. Reads `window.__CCB__` to get config + cssVars + proofEndpoint
 *   3. Sanitises cssVars (allowlist + value scrubbing matching loader.js)
 *   4. Calls `<cookie-consent>.configure(config)`
 *   5. Wires a `consent:update` listener that POSTs proofs to proofEndpoint
 */

import './index.js';
import type { CookieConsentConfig, ConsentEventDetail } from './core/types.js';

interface EmbedConfig extends CookieConsentConfig {
  /** Site identifier set by the host (Atomic Site site_id) */
  siteId: string;
  /** Public hostname the consent applies to */
  domain: string;
  /** Where to POST consent proofs. Defaults to /t/consent (same-origin). */
  proofEndpoint?: string;
  /** CSS custom properties to apply on the host element (sanitised, allowlisted). */
  cssVars?: Record<string, string>;
  /**
   * Plain-string copy overrides. Convenience layer that maps to the widget's
   * translations object so hosts don't have to construct full TranslationStrings.
   */
  copy?: {
    title?: string;
    description?: string;
    accept?: string;
    reject?: string;
    customize?: string;
  };
}

declare global {
  interface Window {
    __CCB__?: EmbedConfig;
    __ceEmbedInit?: boolean;
  }
}

const ALLOWED_CSS_VARS: ReadonlyArray<string> = [
  '--cc-bg', '--cc-bg-secondary', '--cc-text', '--cc-text-secondary', '--cc-border',
  '--cc-btn-primary-bg', '--cc-btn-primary-text', '--cc-btn-secondary-bg', '--cc-btn-secondary-text',
  '--cc-btn-reject-bg', '--cc-btn-reject-text', '--cc-toggle-on', '--cc-toggle-off',
  '--cc-overlay', '--cc-radius', '--cc-radius-sm', '--cc-font', '--cc-z-index',
  '--cc-max-width', '--cc-shadow',
];

function sanitiseCssValue(raw: unknown): string | null {
  let v = String(raw)
    .replace(/[;\r\n\\]/g, '')
    .replace(/url\s*\(/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/image-set\s*\(/gi, '')
    .replace(/image\s*\(/gi, '')
    .replace(/cross-fade\s*\(/gi, '');
  if (/[a-zA-Z][\w-]*\s*\(/.test(v) && !/^[^()]*(?:(?:rgba?|hsla?|calc|min|max|clamp|var)\([^)]*\)[^()]*)*$/.test(v)) {
    return null;
  }
  return v;
}

function applyCssVars(el: HTMLElement, cssVars: Record<string, string>): void {
  let style = '';
  for (const p of Object.keys(cssVars)) {
    if (ALLOWED_CSS_VARS.indexOf(p) === -1) continue;
    const v = sanitiseCssValue(cssVars[p]);
    if (v === null) continue;
    style += `${p}:${v};`;
  }
  if (style) el.setAttribute('style', style);
}

function applyCopyOverrides(config: CookieConsentConfig, copy: NonNullable<EmbedConfig['copy']>): void {
  const lang = config.language || 'en';
  if (!config.translations) config.translations = {};
  if (!config.translations[lang]) {
    config.translations[lang] = { banner: {}, preferences: {}, categories: {}, trigger: {} } as never;
  }
  const t = config.translations[lang] as Record<string, Record<string, string>>;
  if (!t.banner) t.banner = {} as Record<string, string>;
  if (copy.title) t.banner.title = copy.title;
  if (copy.description) t.banner.description = copy.description;
  if (copy.accept) t.banner.acceptAll = copy.accept;
  if (copy.reject) t.banner.rejectAll = copy.reject;
  if (copy.customize) t.banner.settings = copy.customize;
}

function postProof(endpoint: string, siteId: string, domain: string, detail: ConsentEventDetail | null): void {
  if (!detail || !detail.consent) return;
  try {
    let sessionId = '';
    try { sessionId = localStorage.getItem('atomicsite_sid') || ''; } catch { /* sandboxed iframe */ }

    const body = JSON.stringify({
      siteId,
      domain,
      sessionId,
      consent: {
        version: detail.consent.version,
        timestamp: detail.consent.timestamp,
        method: detail.consent.method,
        categories: detail.consent.categories,
      },
      page: location.href.slice(0, 2000),
      referrer: document.referrer.slice(0, 2000),
      gpc: !!(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl,
    });

    let sent = false;
    if (navigator.sendBeacon) {
      try {
        sent = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      } catch { /* fall through */ }
    }
    if (!sent) {
      fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
      }).catch(() => { /* swallow; proof is best-effort */ });
    }
  } catch { /* swallow */ }
}

function init(): void {
  if (window.__ceEmbedInit) return;
  window.__ceEmbedInit = true;

  const cfg = window.__CCB__;
  if (!cfg || typeof cfg !== 'object') {
    console.error('[cookieproof-embed] window.__CCB__ is missing or not an object; widget will not render');
    return;
  }
  if (!cfg.siteId || !cfg.domain) {
    console.error('[cookieproof-embed] window.__CCB__ requires siteId and domain');
    return;
  }

  const proofEndpoint = cfg.proofEndpoint || '/t/consent';
  const siteId = cfg.siteId;
  const domain = cfg.domain;

  const el = document.createElement('cookie-consent') as HTMLElement & {
    configure?: (c: CookieConsentConfig) => void;
  };

  if (cfg.cssVars && typeof cfg.cssVars === 'object') {
    applyCssVars(el, cfg.cssVars);
  }

  // Strip embed-specific keys before passing to the widget
  const { cssVars: _cv, proofEndpoint: _pe, copy, siteId: _sid, domain: _dom, ...rest } = cfg;
  const widgetConfig: CookieConsentConfig = rest;

  if (copy && typeof copy === 'object') {
    applyCopyOverrides(widgetConfig, copy);
  }

  document.body.appendChild(el);
  if (el.configure) {
    el.configure(widgetConfig);
  } else {
    // Same shape as the configurator/loader.js fix at commit e7eac03c
    // (2026-05-14 pre-flight). Without the .catch, a customElements
    // registration rejection or a throw inside configure() would
    // surface as an unhandled promise rejection in the host page.
    customElements
      .whenDefined('cookie-consent')
      .then(() => {
        const e = el as HTMLElement & { configure: (c: CookieConsentConfig) => void };
        e.configure(widgetConfig);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[cookieproof-embed] configure failed:', err && (err as Error).message);
      });
  }

  // Proof relay. `consent:update` fires for accept/reject/custom/GPC and cross-tab changes.
  document.addEventListener('consent:update', (e) => {
    postProof(proofEndpoint, siteId, domain, (e as CustomEvent<ConsentEventDetail>).detail);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else if (document.body) {
  init();
} else {
  // edge case: head script before body parsed
  document.addEventListener('DOMContentLoaded', init);
}

export {};
