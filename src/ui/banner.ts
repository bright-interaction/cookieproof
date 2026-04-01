import type { TranslationStrings, CookieConsentConfig } from '../core/types.js';
import { esc, escAttr } from './utils.js';

export interface BannerCallbacks {
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onSettings: () => void;
  onDoNotSell?: () => void;
  /** Called when user presses Escape — should hide without making consent decision */
  onDismiss?: () => void;
}

export interface LanguageOptions {
  languages: string[];
  current: string;
  names: Record<string, string>;
  onChange: (lang: string) => void;
}

export function createBanner(
  t: TranslationStrings,
  position: string,
  callbacks: BannerCallbacks,
  privacyPolicyUrl?: string,
  config?: CookieConsentConfig,
  languageOptions?: LanguageOptions
): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'cc-banner';
  banner.setAttribute('part', 'banner');
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-labelledby', 'cc-banner-title');
  banner.setAttribute('aria-describedby', 'cc-banner-desc');
  banner.setAttribute('aria-hidden', 'true');
  banner.setAttribute('data-position', position);

  if (!privacyPolicyUrl) {
    console.warn('[cookieproof] No privacyPolicyUrl configured. GDPR requires informing users about cookie usage.');
  }

  const safeUrl = privacyPolicyUrl && /^(https?:\/\/|\/)/i.test(privacyPolicyUrl) ? escAttr(privacyPolicyUrl) : '';
  const policyLink = safeUrl
    ? ` <a href="${safeUrl}" class="cc-link" part="privacy-link" target="_blank" rel="noopener">${esc(t.banner.privacyPolicy)}</a>`
    : '';

  const dnsLink = config?.ccpaEnabled
    ? `<div class="cc-dns-link" part="dns-link"><a href="#" data-action="do-not-sell" class="cc-link">${esc(t.banner.doNotSell ?? t.ccpa?.linkText ?? 'Do Not Sell My Info')}</a></div>`
    : '';

  const langSelect = buildLanguageSelect(languageOptions);

  banner.innerHTML = `
    <div class="cc-banner-header"${!langSelect ? ' style="display:block"' : ''}>
      <h2 id="cc-banner-title" class="cc-banner-title" part="banner-title">${esc(t.banner.title)}</h2>
      ${langSelect}
    </div>
    <p id="cc-banner-desc" class="cc-banner-desc" part="banner-description">${esc(t.banner.description)}${policyLink}</p>
    <div class="cc-banner-actions" part="banner-actions">
      <button type="button" class="cc-btn cc-btn-reject" part="btn btn-reject" data-action="reject">${esc(t.banner.rejectAll)}</button>
      <button type="button" class="cc-btn cc-btn-accept" part="btn btn-accept" data-action="accept">${esc(t.banner.acceptAll)}</button>
      <button type="button" class="cc-btn cc-btn-settings" part="btn btn-settings" data-action="settings">${esc(t.banner.settings)}</button>
    </div>
    ${dnsLink}
  `;

  banner.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'accept') callbacks.onAcceptAll();
    else if (action === 'reject') callbacks.onRejectAll();
    else if (action === 'settings') callbacks.onSettings();
    else if (action === 'do-not-sell') {
      e.preventDefault();
      callbacks.onDoNotSell?.();
    }
  });

  // Language selector change handler
  if (languageOptions) {
    const select = banner.querySelector('.cc-lang-select') as HTMLSelectElement | null;
    select?.addEventListener('change', () => languageOptions.onChange(select.value));
  }

  // Escape key dismisses banner without making a consent decision
  // (prevents accidental rejection from a dismissal key)
  banner.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Use onDismiss if provided, otherwise fall back to onSettings
      // (allows user to reconsider via preferences instead of auto-rejecting)
      if (callbacks.onDismiss) callbacks.onDismiss();
      else callbacks.onSettings();
    }
  });

  return banner;
}

function buildLanguageSelect(opts?: LanguageOptions): string {
  if (!opts || opts.languages.length < 2) return '';
  const options = opts.languages.map(code => {
    const name = opts.names[code] ?? code;
    const selected = code === opts.current ? ' selected' : '';
    return `<option value="${escAttr(code)}"${selected}>${esc(name)}</option>`;
  }).join('');
  return `<select class="cc-lang-select" part="language-select" aria-label="Language">${options}</select>`;
}
