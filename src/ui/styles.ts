export function getStyles(): string {
  return `
    :host {
      --cc-bg: #ffffff;
      --cc-bg-secondary: #f9fafb;
      --cc-text: #1a1a1a;
      --cc-text-secondary: #6b7280;
      --cc-border: #e5e7eb;
      --cc-btn-primary-bg: #0d9488;
      --cc-btn-primary-text: #ffffff;
      --cc-btn-secondary-bg: #e5e7eb;
      --cc-btn-secondary-text: #374151;
      --cc-toggle-on: #0d9488;
      --cc-btn-reject-bg: #374151;
      --cc-btn-reject-text: #ffffff;
      --cc-toggle-off: #737a85;
      --cc-overlay: rgba(0, 0, 0, 0.4);
      --cc-radius: 12px;
      --cc-radius-sm: 8px;
      --cc-font: system-ui, -apple-system, sans-serif;
      --cc-z-index: 10000;
      --cc-max-width: 640px;
      --cc-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);

      font-family: var(--cc-font);
      font-size: 14px;
      line-height: 1.5;
      color: var(--cc-text);
      -webkit-font-smoothing: antialiased;
      contain: layout style;
    }

    :host([data-theme="dark"]) {
      --cc-bg: #1f2937;
      --cc-bg-secondary: #111827;
      --cc-text: #f3f4f6;
      --cc-text-secondary: #d1d5db;
      --cc-border: #374151;
      --cc-btn-primary-bg: #2dd4bf;
      --cc-btn-primary-text: #111827;
      --cc-btn-secondary-bg: #374151;
      --cc-btn-secondary-text: #e5e7eb;
      --cc-toggle-on: #2dd4bf;
      --cc-toggle-off: #727b87;
      /* WCAG AA fix: #4b5563 on white text = 7.5:1 contrast ratio */
      --cc-btn-reject-bg: #4b5563;
      --cc-btn-reject-text: #ffffff;
      --cc-overlay: rgba(0, 0, 0, 0.6);
    }

    @media (prefers-color-scheme: dark) {
      :host([data-theme="auto"]) {
        --cc-bg: #1f2937;
        --cc-bg-secondary: #111827;
        --cc-text: #f3f4f6;
        --cc-text-secondary: #d1d5db;
        --cc-border: #374151;
        --cc-btn-primary-bg: #2dd4bf;
        --cc-btn-primary-text: #111827;
        --cc-btn-secondary-bg: #374151;
        --cc-btn-secondary-text: #e5e7eb;
        --cc-toggle-on: #2dd4bf;
        --cc-toggle-off: #727b87;
        /* WCAG AA fix: #4b5563 on white text = 7.5:1 contrast ratio */
        --cc-btn-reject-bg: #4b5563;
        --cc-btn-reject-text: #ffffff;
        --cc-overlay: rgba(0, 0, 0, 0.6);
      }
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .cc-overlay {
      position: fixed;
      inset: 0;
      background: var(--cc-overlay);
      z-index: var(--cc-z-index);
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .cc-overlay.visible {
      opacity: 1;
      pointer-events: auto;
    }

    /* ---- Banner (Layer 1) ---- */
    .cc-banner {
      position: fixed;
      z-index: calc(var(--cc-z-index) + 1);
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      width: calc(100% - 32px);
      max-width: var(--cc-max-width);
      background: var(--cc-bg);
      border: 1px solid var(--cc-border);
      border-radius: var(--cc-radius);
      box-shadow: var(--cc-shadow);
      padding: 24px;
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }
    .cc-banner.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    .cc-banner[data-position="bottom"] {
      bottom: 16px;
    }
    .cc-banner[data-position="top"] {
      top: 16px;
    }
    .cc-banner[data-position="center"] {
      top: 50%;
      transform: translateX(-50%) translateY(calc(-50% + 20px));
    }
    .cc-banner[data-position="center"].visible {
      transform: translateX(-50%) translateY(-50%);
    }

    .cc-banner-header, .cc-prefs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .cc-banner-header { margin-bottom: 8px; }
    .cc-prefs-header { margin-bottom: 16px; }

    .cc-banner-title {
      font-size: 16px;
      font-weight: 600;
    }

    .cc-lang-select {
      appearance: none;
      -webkit-appearance: none;
      background: var(--cc-bg-secondary);
      color: var(--cc-text);
      border: 1px solid var(--cc-border);
      border-radius: var(--cc-radius-sm);
      padding: 4px 24px 4px 8px;
      font-family: var(--cc-font);
      font-size: 12px;
      cursor: pointer;
      flex-shrink: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
    }
    .cc-lang-select:focus-visible {
      outline: 2px solid var(--cc-btn-primary-bg);
      outline-offset: 2px;
    }

    .cc-banner-desc {
      color: var(--cc-text-secondary);
      margin-bottom: 20px;
    }

    /* ---- Links ---- */
    .cc-link {
      color: var(--cc-btn-primary-bg);
      /* WCAG: Links must be distinguishable by more than color alone */
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      font-weight: 500;
      margin-left: 4px;
    }
    .cc-link:hover {
      text-decoration-thickness: 2px;
    }
    .cc-link:focus-visible {
      outline: 2px solid var(--cc-btn-primary-bg);
      outline-offset: 2px;
      border-radius: 2px;
    }

    .cc-banner-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cc-dns-link {
      margin-top: 12px;
      text-align: center;
      font-size: 13px;
    }
    .cc-dns-link a {
      color: var(--cc-text-secondary);
      text-decoration: underline;
    }

    /* ---- Buttons (IMY compliant: symmetric) ---- */
    .cc-btn {
      flex: 1 1 0;
      min-width: 0;
      padding: 12px 16px;
      border: 1px solid var(--cc-border);
      border-radius: var(--cc-radius-sm);
      font-family: var(--cc-font);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
      text-align: center;
      white-space: nowrap;
    }
    .cc-btn:focus-visible {
      outline: 2px solid var(--cc-btn-primary-bg);
      outline-offset: 2px;
    }
    .cc-btn-accept {
      background: var(--cc-btn-primary-bg);
      color: var(--cc-btn-primary-text);
      border-color: var(--cc-btn-primary-bg);
    }
    .cc-btn-accept:hover {
      filter: brightness(1.1);
    }
    /* IMY 2026: Reject has EQUAL visual weight — both buttons are solid filled */
    .cc-btn-reject {
      background: var(--cc-btn-reject-bg);
      color: var(--cc-btn-reject-text);
      border-color: var(--cc-btn-reject-bg);
    }
    .cc-btn-reject:hover {
      filter: brightness(1.15);
    }
    .cc-btn-settings {
      background: var(--cc-btn-secondary-bg);
      color: var(--cc-btn-secondary-text);
      border-color: var(--cc-border);
    }
    .cc-btn-settings:hover {
      background: var(--cc-btn-secondary-hover, var(--cc-border));
    }

    /* ---- Preferences (Layer 2) ---- */
    .cc-preferences {
      position: fixed;
      z-index: calc(var(--cc-z-index) + 2);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.95);
      width: calc(100% - 32px);
      max-width: var(--cc-max-width);
      max-height: calc(100vh - 64px);
      display: flex;
      flex-direction: column;
      background: var(--cc-bg);
      border: 1px solid var(--cc-border);
      border-radius: var(--cc-radius);
      box-shadow: var(--cc-shadow);
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
    }
    .cc-preferences.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      pointer-events: auto;
    }
    .cc-prefs-scroll {
      overflow-y: auto;
      padding: 24px;
      flex: 1;
      min-height: 0;
    }

    .cc-prefs-title {
      font-size: 16px;
      font-weight: 600;
    }

    .cc-category {
      padding: 16px 0;
      border-bottom: 1px solid var(--cc-border);
    }
    .cc-category:last-of-type {
      border-bottom: none;
    }

    .cc-category-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .cc-category-info {
      flex: 1;
    }

    .cc-category-name {
      font-weight: 500;
      font-size: 14px;
    }

    .cc-category-desc {
      color: var(--cc-text-secondary);
      font-size: 13px;
      margin-top: 4px;
    }

    .cc-category-badge {
      font-size: 11px;
      color: var(--cc-text);
      background: var(--cc-border);
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
    }

    /* ---- Cookie Declaration Table ---- */
    .cc-cookie-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12px;
      table-layout: fixed;
    }
    .cc-cookie-table col:nth-child(1) { width: 22%; }
    .cc-cookie-table col:nth-child(2) { width: 18%; }
    .cc-cookie-table col:nth-child(3) { width: 44%; }
    .cc-cookie-table col:nth-child(4) { width: 16%; }
    .cc-cookie-table th {
      text-align: left;
      font-weight: 500;
      color: var(--cc-text-secondary);
      padding: 6px 8px;
      border-bottom: 1px solid var(--cc-border);
      white-space: nowrap;
    }
    .cc-cookie-table td {
      padding: 5px 8px;
      color: var(--cc-text-secondary);
      border-bottom: 1px solid var(--cc-border);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 0;
    }
    .cc-cookie-table tr:last-child td {
      border-bottom: none;
    }
    .cc-cookie-table code {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
      font-size: 11px;
      background: var(--cc-bg-secondary);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* ---- Toggle Switch ---- */
    .cc-toggle {
      position: relative;
      width: 52px;
      height: 44px;
      flex-shrink: 0;
    }
    .cc-toggle input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .cc-toggle-track {
      position: absolute;
      top: 6px;
      left: 0;
      right: 0;
      height: 32px;
      background: var(--cc-toggle-off);
      border-radius: 16px;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .cc-toggle input:checked + .cc-toggle-track {
      background: var(--cc-toggle-on);
    }
    .cc-toggle-track::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 26px;
      height: 26px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }
    .cc-toggle input:checked + .cc-toggle-track::after {
      transform: translateX(20px);
    }
    .cc-toggle input:focus-visible + .cc-toggle-track {
      outline: 2px solid var(--cc-btn-primary-bg);
      outline-offset: 2px;
    }
    .cc-toggle input:disabled + .cc-toggle-track {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* ---- Learn More (collapsible) ---- */
    .cc-more-info {
      margin-bottom: 8px;
      border-bottom: 1px solid var(--cc-border);
      padding-bottom: 12px;
    }
    .cc-more-info-toggle {
      font-size: 13px;
      font-weight: 500;
      color: var(--cc-btn-primary-bg);
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cc-more-info-toggle:focus-visible {
      outline: 2px solid var(--cc-btn-primary-bg);
      outline-offset: 2px;
      border-radius: 2px;
    }
    .cc-more-info-toggle::-webkit-details-marker {
      display: none;
    }
    .cc-more-info-toggle::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-right: 2px solid var(--cc-btn-primary-bg);
      border-bottom: 2px solid var(--cc-btn-primary-bg);
      transform: rotate(-45deg);
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }
    .cc-more-info[open] > .cc-more-info-toggle::before {
      transform: rotate(45deg);
    }
    .cc-more-info-text {
      color: var(--cc-text-secondary);
      font-size: 13px;
      line-height: 1.6;
      margin-top: 10px;
    }

    .cc-prefs-actions {
      display: flex;
      gap: 8px;
      margin-top: 20px;
    }

    .cc-prefs-footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--cc-border);
      text-align: center;
      font-size: 13px;
    }
    .cc-prefs-footer .cc-link {
      margin-left: 0;
    }

    /* ---- Floating Trigger ---- */
    .cc-trigger {
      position: fixed;
      z-index: var(--cc-z-index);
      bottom: 16px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--cc-bg);
      border: 1px solid var(--cc-border);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s ease, transform 0.2s ease;
      opacity: 0;
      transform: scale(0.8);
      pointer-events: none;
      padding: 0;
    }
    .cc-trigger.visible {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }
    .cc-trigger:hover {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .cc-trigger:focus-visible {
      outline: 2px solid var(--cc-btn-primary-bg);
      outline-offset: 2px;
    }
    .cc-trigger[data-position="left"] {
      left: 16px;
    }
    .cc-trigger[data-position="right"] {
      right: 16px;
    }
    .cc-trigger svg {
      width: 20px;
      height: 20px;
      fill: var(--cc-text);
    }

    /* ---- Responsive ---- */
    @media (max-width: 480px) {
      .cc-banner {
        width: calc(100% - 16px);
        padding: 16px;
      }
      .cc-banner-actions {
        flex-direction: column;
      }
      .cc-btn {
        flex: none;
        width: 100%;
      }
      .cc-preferences {
        width: calc(100% - 16px);
      }
      .cc-prefs-scroll {
        padding: 16px;
      }
      .cc-prefs-actions {
        flex-direction: column;
      }
      .cc-cookie-table {
        table-layout: auto;
      }
      .cc-cookie-table colgroup {
        display: none;
      }
      .cc-cookie-table thead {
        display: none;
      }
      .cc-cookie-table tbody tr {
        display: block;
        padding: 10px 0;
        border-bottom: 1px solid var(--cc-border);
      }
      .cc-cookie-table tbody tr:last-child {
        border-bottom: none;
      }
      .cc-cookie-table td {
        display: block;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        max-width: none;
        padding: 2px 0;
        border-bottom: none;
      }
      .cc-cookie-table td::before {
        content: attr(data-label);
        display: inline-block;
        font-weight: 500;
        color: var(--cc-text);
        min-width: 70px;
        margin-right: 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
    }

    /* ---- Reduced motion ---- */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* ---- Print ---- */
    @media print {
      .cc-overlay, .cc-banner, .cc-preferences, .cc-trigger {
        display: none !important;
      }
    }

    /* ---- Tablet ---- */
    @media (max-width: 768px) {
      .cc-banner { padding: 18px; }
      .cc-preferences { max-width: 100%; }
    }

    /* ---- Sticky cookie table header ---- */
    .cc-cookie-table thead {
      position: sticky;
      top: 0;
      background: var(--cc-bg);
      z-index: 1;
    }

    /* ---- Forced colors (Windows High Contrast mode) ---- */
    @media (forced-colors: active) {
      .cc-toggle-track { border: 2px solid ButtonText; }
      .cc-toggle-track::after { background: ButtonFace; }
      .cc-toggle input:checked + .cc-toggle-track { background: Highlight; border-color: Highlight; }
      .cc-btn-accept, .cc-btn-reject, .cc-btn-settings { border: 2px solid ButtonText; }
      .cc-link { color: LinkText; }
      .cc-link:focus-visible,
      .cc-btn:focus-visible,
      .cc-more-info-toggle:focus-visible,
      .cc-toggle input:focus-visible + .cc-toggle-track { outline: 2px solid Highlight; outline-offset: 2px; }
      .cc-toggle input:disabled + .cc-toggle-track { border-color: GrayText; opacity: 1; }
    }

    /* ---- Consent Expiry Notice ---- */
    .cc-expiry-notice {
      position: fixed;
      z-index: calc(var(--cc-z-index) + 1);
      bottom: 72px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--cc-bg);
      border: 1px solid var(--cc-border);
      border-radius: var(--cc-radius-sm);
      padding: 12px 20px;
      font-size: 13px;
      color: var(--cc-text-secondary);
      box-shadow: var(--cc-shadow);
      display: flex;
      align-items: center;
      opacity: 0;
      transition: opacity 0.25s ease;
      pointer-events: none;
    }
    .cc-expiry-notice.visible {
      opacity: 1;
      pointer-events: auto;
    }

    /* ---- Long text overflow safety ---- */
    .cc-banner-title,
    .cc-banner-desc,
    .cc-category-name,
    .cc-category-desc,
    .cc-more-info-text,
    .cc-prefs-footer {
      overflow-wrap: break-word;
      word-wrap: break-word;
    }
  `;
}
