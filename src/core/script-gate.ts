import type { CategoryConfig } from './types.js';
import { StorageAdapter } from './storage.js';

const CONSENT_ATTR = 'data-consent';

/** Whitelist safe URL protocols to prevent javascript:/data: XSS on activation */
function isSafeUrl(url: string): boolean {
  // Strip ASCII whitespace and common Unicode whitespace/invisible chars before protocol check
  const trimmed = url.replace(/^[\s\u200B\u00AD\uFEFF\u200C\u200D]+/, '').toLowerCase();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('//');
}

/** Safely escape a value for use in a CSS attribute selector */
function cssSafeAttr(value: string): string {
  // CSS.escape is available in all modern browsers
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  // Fallback: escape characters that break CSS attribute selectors
  // Covers quotes, backslash, closing bracket, newlines, and null bytes
  return value.replace(/[\0\n\r\f"\\[\]]/g, (ch) => {
    if (ch === '\0') return '\uFFFD';
    return '\\' + ch;
  });
}

export class ScriptGate {
  private observer: MutationObserver | null = null;
  private observerStarted = false;
  private categories: CategoryConfig[];
  private consentState: Record<string, boolean> = {};
  private activatedScripts = new Set<string>();
  private _cspNonce: string | null | undefined;
  private cspViolationHandler: ((e: SecurityPolicyViolationEvent) => void) | null = null;
  private loggedHashes = new Set<string>();

  constructor(categories: CategoryConfig[]) {
    this.categories = categories;
    this.listenForCspViolations();
  }

  /** Start the MutationObserver with all categories denied (before consent decision) */
  startBlocking(): void {
    this.consentState = {};
    this.startObserver();
  }

  updateConsent(consent: Record<string, boolean>): void {
    const previous = { ...this.consentState };
    this.consentState = { ...consent };

    // Activate newly consented categories
    for (const [cat, granted] of Object.entries(consent)) {
      if (granted && !previous[cat]) {
        this.activateCategory(cat);
      }
    }

    // Clean up revoked categories
    for (const [cat, granted] of Object.entries(previous)) {
      if (!consent[cat] && granted) {
        this.deactivateCategory(cat);
      }
    }
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observerStarted = false;
    this.activatedScripts.clear();
    this.loggedHashes.clear();
    if (this.cspViolationHandler) {
      document.removeEventListener('securitypolicyviolation', this.cspViolationHandler);
      this.cspViolationHandler = null;
    }
  }

  private listenForCspViolations(): void {
    this.cspViolationHandler = (e: SecurityPolicyViolationEvent) => {
      // Only handle script-src violations for inline scripts
      if (!e.violatedDirective.startsWith('script-src') || e.disposition !== 'enforce') return;
      // blockedURI is 'inline' for inline script violations
      if (e.blockedURI !== 'inline') return;

      const sample = e.sample;
      if (!sample) return;

      this.computeAndLogHash(sample);
    };
    document.addEventListener('securitypolicyviolation', this.cspViolationHandler);
  }

  private async computeAndLogHash(sample: string): Promise<void> {
    if (!crypto?.subtle) return;

    // Find the full inline script content matching this violation sample
    // (CSP sample is truncated to ~40 chars, so match against known scripts)
    const scripts = document.querySelectorAll<HTMLScriptElement>('script');
    let content = sample;
    for (const script of scripts) {
      if (script.textContent && script.textContent.startsWith(sample)) {
        content = script.textContent;
        break;
      }
    }

    try {
      const encoded = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
      const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

      if (this.loggedHashes.has(hashBase64)) return;
      this.loggedHashes.add(hashBase64);

      console.warn(
        `[cookieproof] Inline script blocked by CSP. To fix, add this to your script-src directive:\n\n` +
        `  'sha256-${hashBase64}'\n\n` +
        `Or for automatic nonce support, add a server-side meta tag:\n` +
        `  <meta name="csp-nonce" content="your-nonce">\n\n` +
        `See: https://docs.brightinteraction.com/cookieproof/csp`
      );
    } catch {
      // Web Crypto unavailable — skip silently
    }
  }

  private activateCategory(category: string): void {
    const safe = cssSafeAttr(category);

    // Activate scripts
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[type="text/plain"][${CONSENT_ATTR}="${safe}"]`
    );
    for (const script of scripts) {
      this.activateScript(script);
    }

    // Activate iframes
    const iframes = document.querySelectorAll<HTMLIFrameElement>(
      `iframe[${CONSENT_ATTR}="${safe}"][data-src]`
    );
    for (const iframe of iframes) {
      this.activateIframe(iframe);
    }

    // Activate images (tracking pixels)
    const images = document.querySelectorAll<HTMLImageElement>(
      `img[${CONSENT_ATTR}="${safe}"][data-src]`
    );
    for (const img of images) {
      const src = img.getAttribute('data-src');
      if (src && isSafeUrl(src)) {
        img.src = src;
        img.removeAttribute('data-src');
      }
    }

    // Activate link elements
    const links = document.querySelectorAll<HTMLLinkElement>(
      `link[${CONSENT_ATTR}="${safe}"][data-href]`
    );
    for (const link of links) {
      const href = link.getAttribute('data-href');
      if (href && isSafeUrl(href)) {
        link.href = href;
        link.removeAttribute('data-href');
      }
    }
  }

  private getCspNonce(): string | null {
    if (this._cspNonce === undefined) {
      this._cspNonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content') ?? null;
    }
    return this._cspNonce;
  }

  private activateScript(original: HTMLScriptElement): void {
    const key = this.scriptKey(original);
    if (this.activatedScripts.has(key)) return;

    // Validate src URL if present (block javascript:, data:, etc.)
    if (original.src && !isSafeUrl(original.src)) {
      console.warn('[cookieproof] Blocked script with unsafe src:', original.src);
      return;
    }

    this.activatedScripts.add(key);

    const replacement = document.createElement('script');
    // Copy safe attributes — skip type, data-original-type, data-consent,
    // and all on* event handler attributes (prevents XSS via onload/onerror)
    for (const attr of original.attributes) {
      if (attr.name === 'type' || attr.name === 'data-original-type' || attr.name === CONSENT_ATTR) continue;
      if (attr.name.startsWith('on')) continue;
      replacement.setAttribute(attr.name, attr.value);
    }

    // Restore original type: check data-original-type or data-type for module scripts
    const originalType = original.getAttribute('data-original-type') || original.getAttribute('data-type');
    if (originalType === 'module') {
      replacement.type = 'module';
    } else {
      replacement.type = 'text/javascript';
    }

    // Apply CSP nonce if available (injected via server-side meta tag)
    const nonce = this.getCspNonce();
    if (nonce) {
      replacement.nonce = nonce;
    }

    // Copy inline content
    if (original.textContent && !original.src) {
      replacement.textContent = original.textContent;
    }

    original.parentNode?.replaceChild(replacement, original);
  }

  private activateIframe(iframe: HTMLIFrameElement): void {
    const src = iframe.getAttribute('data-src');
    if (!src || !isSafeUrl(src)) return;

    iframe.src = src;
    iframe.removeAttribute('data-src');

    // Remove placeholder overlay if present
    const placeholder = iframe.parentElement?.querySelector('[data-consent-placeholder]');
    placeholder?.remove();
    iframe.style.removeProperty('display');
  }

  private deactivateCategory(category: string): void {
    const safe = cssSafeAttr(category);

    // Clear cookies for all services in this category
    const cat = this.categories.find((c) => c.id === category);
    if (cat?.services) {
      for (const service of cat.services) {
        if (service.cookies?.length) {
          StorageAdapter.clearCookies(service.cookies);
        }
      }
    }

    // Remove activated script keys for this category so they can be re-activated.
    // Replacement scripts don't have data-consent (to avoid MutationObserver warnings),
    // so match by category prefix in the key set instead of querying the DOM.
    const prefix = category + '::';
    for (const key of this.activatedScripts) {
      if (key.startsWith(prefix)) this.activatedScripts.delete(key);
    }
    // Note: cannot un-execute scripts. They will be blocked on next page load.

    // Deactivate iframes — stop embedded content
    const iframes = document.querySelectorAll<HTMLIFrameElement>(
      `iframe[${CONSENT_ATTR}="${safe}"]`
    );
    for (const iframe of iframes) {
      if (iframe.src && !iframe.hasAttribute('data-src')) {
        iframe.setAttribute('data-src', iframe.src);
        iframe.src = 'about:blank';
      }
    }

    // Deactivate images (tracking pixels)
    const images = document.querySelectorAll<HTMLImageElement>(
      `img[${CONSENT_ATTR}="${safe}"]`
    );
    for (const img of images) {
      if (img.src && !img.hasAttribute('data-src')) {
        img.setAttribute('data-src', img.src);
        img.removeAttribute('src');
      }
    }

    // Deactivate link elements
    const links = document.querySelectorAll<HTMLLinkElement>(
      `link[${CONSENT_ATTR}="${safe}"]`
    );
    for (const link of links) {
      if (link.href && !link.hasAttribute('data-href')) {
        link.setAttribute('data-href', link.href);
        link.removeAttribute('href');
      }
    }
  }

  private startObserver(): void {
    if (this.observerStarted) return;
    this.observerStarted = true;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          // Check the node itself
          if (node instanceof HTMLScriptElement) {
            try { this.interceptScript(node); } catch (err) {
              console.error('[cookieproof] Script interception error:', err);
            }
          }

          // Check children (e.g., a div containing scripts)
          const scripts = node.querySelectorAll?.(`script[${CONSENT_ATTR}]`);
          scripts?.forEach((s) => {
            if (s instanceof HTMLScriptElement) {
              try { this.interceptScript(s); } catch (err) {
                console.error('[cookieproof] Script interception error:', err);
              }
            }
          });
        }
      }
    });

    this.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private interceptScript(script: HTMLScriptElement): void {
    const category = script.getAttribute(CONSENT_ATTR);
    if (!category) return;

    // If the script has type="module", convert to text/plain and store original type
    if (script.type === 'module') {
      script.setAttribute('data-original-type', 'module');
      script.type = 'text/plain';
    }

    if (script.type === 'text/plain') {
      // Already blocked by markup — activate if consented
      if (this.consentState[category]) {
        this.activateScript(script);
      }
    }
    // If type is not text/plain, the browser may have already executed it.
    // Warn developers about misconfigured markup so they can fix it.
    if (script.type !== 'text/plain') {
      console.warn(
        `[cookieproof] Script with data-consent="${category}" has type="${script.type || 'text/javascript'}" — ` +
        'it may have already executed. Set type="text/plain" in markup to ensure blocking.'
      );
    }
  }

  private scriptKey(script: HTMLScriptElement): string {
    // Include category in key to prevent collisions between inline scripts
    // with identical content but different data-consent categories.
    const category = script.getAttribute(CONSENT_ATTR) ?? '';
    if (script.src) return category + '::' + script.src;
    if (script.textContent) {
      // Cap at 200 chars to prevent unbounded memory usage from large inline scripts
      const text = script.textContent;
      const summary = text.length <= 200 ? text : text.slice(0, 100) + '...' + text.slice(-100);
      return category + '::inline::' + summary;
    }
    return category + '::inline-empty::' +
      Array.from(script.attributes).map(a => a.name + '=' + a.value).join(',');
  }
}
