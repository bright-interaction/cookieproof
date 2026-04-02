import type { CategoryConfig, CookieDeclaration, TranslationStrings } from '../core/types.js';
import { esc, escAttr, safeId } from './utils.js';
import type { LanguageOptions } from './banner.js';

export interface PreferencesCallbacks {
  onSave: (selected: Record<string, boolean>) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose?: () => void;
}

export function createPreferences(
  categories: CategoryConfig[],
  currentConsent: Record<string, boolean>,
  t: TranslationStrings,
  callbacks: PreferencesCallbacks,
  privacyPolicyUrl?: string,
  languageOptions?: LanguageOptions
): HTMLElement {
  const prefs = document.createElement('div');
  prefs.className = 'cc-preferences';
  prefs.setAttribute('part', 'preferences');
  prefs.setAttribute('role', 'dialog');
  prefs.setAttribute('aria-labelledby', 'cc-prefs-title');
  prefs.setAttribute('aria-modal', 'true');

  const categoriesHtml = categories
    .map((cat) => {
      const catT = t.categories[cat.id] ?? { label: cat.label ?? cat.id, description: cat.description ?? '' };
      // IMY 2026 / GDPR: never pre-tick optional categories on first visit.
      // Only show checked if the user has previously given explicit consent.
      const hasExplicitConsent = Object.keys(currentConsent).length > 0;
      const checked = cat.required ? true : (hasExplicitConsent ? (currentConsent[cat.id] ?? false) : false);
      const disabled = cat.required ? 'disabled' : '';
      const badge = cat.required ? `<span class="cc-category-badge" part="category-badge" aria-label="${escAttr(t.alwaysOnLabel ?? 'Always active')}">${esc(t.alwaysOnLabel ?? 'Always active')}</span>` : '';
      const cookieTable = buildCookieTable(cat.declarations, t);

      const sid = safeId(cat.id);
      return `
        <div class="cc-category" part="category" data-category="${escAttr(cat.id)}">
          <div class="cc-category-header">
            <div class="cc-category-info">
              <div class="cc-category-name" part="category-name" id="cc-cat-label-${sid}">${esc(catT.label)} ${badge}</div>
              <p class="cc-category-desc" part="category-description" id="cc-cat-desc-${sid}">${esc(catT.description)}</p>
            </div>
            <label class="cc-toggle" part="category-toggle">
              <input type="checkbox" data-category-id="${escAttr(cat.id)}" aria-labelledby="cc-cat-label-${sid}" aria-describedby="cc-cat-desc-${sid}" ${checked ? 'checked' : ''} ${disabled} />
              <span class="cc-toggle-track"></span>
            </label>
          </div>
          ${cookieTable}
        </div>
      `;
    })
    .join('');

  const safeUrl = privacyPolicyUrl && /^(https?:\/\/|\/)/i.test(privacyPolicyUrl) ? escAttr(privacyPolicyUrl) : '';
  const policyLink = safeUrl
    ? `<a href="${safeUrl}" class="cc-link" part="privacy-link" target="_blank" rel="noopener">${esc(t.preferences.privacyPolicy)}</a>`
    : '';

  const langSelect = buildLanguageSelect(languageOptions);

  prefs.innerHTML = `
    <div class="cc-prefs-scroll" part="preferences-scroll" tabindex="0" role="region" aria-labelledby="cc-prefs-title">
      <div class="cc-prefs-header"${!langSelect ? ' style="display:block"' : ''}>
        <h2 id="cc-prefs-title" class="cc-prefs-title" part="preferences-title">${esc(t.preferences.title)}</h2>
        ${langSelect}
      </div>
      <details class="cc-more-info" part="more-info">
        <summary class="cc-more-info-toggle" part="more-info-toggle">${esc(t.preferences.moreInfo)}</summary>
        <p class="cc-more-info-text" part="more-info-text">${esc(t.preferences.moreInfoText)}</p>
      </details>
      ${categoriesHtml}
      <div class="cc-prefs-actions" part="preferences-actions">
        <button type="button" class="cc-btn cc-btn-reject" part="btn btn-reject-all" data-action="reject-all">${esc(t.preferences.rejectAll ?? t.banner.rejectAll)}</button>
        <button type="button" class="cc-btn cc-btn-accept" part="btn btn-accept-all" data-action="accept-all">${esc(t.preferences.acceptAll)}</button>
        <button type="button" class="cc-btn cc-btn-settings" part="btn btn-save" data-action="save">${esc(t.preferences.save)}</button>
      </div>
      ${policyLink ? `<div class="cc-prefs-footer" part="preferences-footer">${policyLink}</div>` : ''}
    </div>
  `;

  prefs.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'save') {
      callbacks.onSave(readToggles(prefs));
    } else if (action === 'accept-all') {
      callbacks.onAcceptAll();
    } else if (action === 'reject-all') {
      callbacks.onRejectAll();
    }
  });

  // Language selector change handler
  if (languageOptions) {
    const select = prefs.querySelector('.cc-lang-select') as HTMLSelectElement | null;
    select?.addEventListener('change', () => languageOptions.onChange(select.value));
  }

  prefs.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      callbacks.onClose?.();
    }
  });

  return prefs;
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

function buildCookieTable(declarations: CookieDeclaration[] | undefined, t: TranslationStrings): string {
  if (!declarations?.length) return '';
  const rows = declarations.map((d) => `
    <tr>
      <td data-label="${escAttr(t.preferences.cookieTableName)}" title="${escAttr(d.name)}"><code>${esc(d.name)}</code></td>
      <td data-label="${escAttr(t.preferences.cookieTableProvider)}" title="${escAttr(d.provider ?? '-')}">${esc(d.provider ?? '-')}</td>
      <td data-label="${escAttr(t.preferences.cookieTablePurpose)}" title="${escAttr(d.purpose ?? '-')}">${esc(d.purpose ?? '-')}</td>
      <td data-label="${escAttr(t.preferences.cookieTableExpiry)}" title="${escAttr(d.expiry ?? '-')}">${esc(d.expiry ?? '-')}</td>
    </tr>
  `).join('');

  return `
    <table class="cc-cookie-table" part="cookie-table">
      <colgroup><col/><col/><col/><col/></colgroup>
      <thead>
        <tr>
          <th scope="col">${esc(t.preferences.cookieTableName)}</th>
          <th scope="col">${esc(t.preferences.cookieTableProvider)}</th>
          <th scope="col">${esc(t.preferences.cookieTablePurpose)}</th>
          <th scope="col">${esc(t.preferences.cookieTableExpiry)}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function readToggles(container: HTMLElement): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  const inputs = container.querySelectorAll<HTMLInputElement>('input[data-category-id]');
  for (const input of inputs) {
    const id = input.getAttribute('data-category-id');
    if (id) result[id] = input.checked;
  }
  return result;
}
