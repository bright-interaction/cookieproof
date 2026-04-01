export { CookieConsentElement } from './consent-element.js';
export type {
  CookieConsentConfig,
  ConsentRecord,
  ConsentEventType,
  ConsentEventDetail,
  CategoryConfig,
  ConsentService,
  CookieDeclaration,
  TranslationStrings,
  CategoryTranslation,
  GCMSignal,
  GCMMapping,
} from './core/types.js';

import { CookieConsentElement } from './consent-element.js';

// Auto-register the custom element (browser only)
if (typeof globalThis.customElements !== 'undefined' && !customElements.get('cookie-consent')) {
  customElements.define('cookie-consent', CookieConsentElement);
}

/**
 * Manually register the <cookie-consent> custom element.
 * Use this in SSR frameworks where you need to control when registration happens.
 * In browser-only setups, the element is registered automatically on import.
 */
export function register(): void {
  if (typeof globalThis.customElements !== 'undefined' && !customElements.get('cookie-consent')) {
    customElements.define('cookie-consent', CookieConsentElement);
  }
}
