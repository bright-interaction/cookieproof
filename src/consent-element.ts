import type {
  CookieConsentConfig,
  ConsentRecord,
  ConsentEventDetail,
  ConsentEventType,
  TranslationStrings,
} from './core/types.js';
import { DEFAULT_CATEGORIES } from './core/constants.js';
import { ConsentManager } from './core/consent-manager.js';
import { ScriptGate } from './core/script-gate.js';
import { EventBus } from './core/events.js';
import { FocusManager } from './ui/a11y.js';
import { getStyles } from './ui/styles.js';
import { createBanner } from './ui/banner.js';
import { createPreferences } from './ui/preferences.js';
import { createFloatingTrigger } from './ui/floating-trigger.js';
import { resolveTranslations, detectLanguage, getAvailableLanguages, LANGUAGE_NAMES } from './i18n/index.js';
import { GCMBridge } from './integrations/gcm.js';

const LANG_STORAGE_KEY = 'ce_language';

export class CookieConsentElement extends HTMLElement {
  private config: CookieConsentConfig = {};
  private manager!: ConsentManager;
  private scriptGate!: ScriptGate;
  private events!: EventBus;
  private focusMgr!: FocusManager;
  private gcm: GCMBridge | null = null;
  private translations!: TranslationStrings;
  private initialized = false;
  public previewMode = false;
  private geoAbort: AbortController | null = null;
  private pendingListeners: Array<{ event: string; callback: (detail: ConsentEventDetail) => void; unsubscribers: Array<() => void> }> = [];
  private gpcTimer: ReturnType<typeof setTimeout> | null = null;
  private gpcRemoveTimer: ReturnType<typeof setTimeout> | null = null;
  private geoTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryRemoveTimer: ReturnType<typeof setTimeout> | null = null;
  private storageHandler: ((e: StorageEvent) => void) | null = null;
  private shortcutHandler: ((e: KeyboardEvent) => void) | null = null;
  private rafHandles: number[] = [];

  private savedScrollY = 0;

  // UI element references
  private overlay!: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private prefsEl: HTMLElement | null = null;
  private triggerEl: HTMLElement | null = null;
  private liveRegion!: HTMLElement;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (this.initialized) return;
    // Use microtask (not RAF) to minimise the window where scripts can slip through.
    // This still allows configure() to be called synchronously after insertion.
    Promise.resolve().then(() => {
      if (!this.initialized && this.isConnected) this.init(this.config);
    });
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  // --- Public API ---

  configure(config: CookieConsentConfig): void {
    this.config = config;
    if (this.isConnected && !this.initialized) {
      this.init(config);
    } else if (this.initialized) {
      // Re-configure at runtime (rebuild UI)
      this.rebuild(config);
    }
  }

  acceptAll(): void {
    if (!this.initialized) return;
    const record = this.manager.acceptAll();
    this.scriptGate.updateConsent(record.categories);
    this.gcm?.update(record.categories);
    try { this.config.onAccept?.(record); } catch (e) { console.error('[cookieproof] onAccept callback error:', e); }
    this.hideBanner();
    this.hidePreferences();
    this.showTrigger();
  }

  rejectAll(): void {
    if (!this.initialized) return;
    const record = this.manager.rejectAll();
    this.scriptGate.updateConsent(record.categories);
    this.gcm?.update(record.categories);
    try { this.config.onReject?.(record); } catch (e) { console.error('[cookieproof] onReject callback error:', e); }
    this.hideBanner();
    this.hidePreferences();
    this.showTrigger();
  }

  private doNotSell(): void {
    if (!this.initialized) return;
    const record = this.manager.doNotSell();
    this.scriptGate.updateConsent(record.categories);
    this.gcm?.update(record.categories);
    try { this.config.onReject?.(record); } catch (e) { console.error('[cookieproof] onReject callback error:', e); }
    this.hideBanner();
    this.hidePreferences();
    this.showTrigger();
  }

  acceptCategory(id: string): void {
    if (!this.initialized) return;
    this.manager.acceptCategory(id);
    const consent = this.manager.getConsent();
    if (consent) {
      this.scriptGate.updateConsent(consent.categories);
      this.gcm?.update(consent.categories);
      try { this.config.onChange?.(consent, [id]); } catch (e) { console.error('[cookieproof] onChange callback error:', e); }
    }
  }

  rejectCategory(id: string): void {
    if (!this.initialized) return;
    this.manager.rejectCategory(id);
    const consent = this.manager.getConsent();
    if (consent) {
      this.scriptGate.updateConsent(consent.categories);
      this.gcm?.update(consent.categories);
      try { this.config.onChange?.(consent, [id]); } catch (e) { console.error('[cookieproof] onChange callback error:', e); }
    }
  }

  getConsent(): ConsentRecord | null {
    return this.manager?.getConsent() ?? null;
  }

  hasConsent(category: string): boolean {
    return this.manager?.hasConsent(category) ?? false;
  }

  showBanner(): void {
    if (!this.initialized || this.config.headless) return;
    this.ensureBanner();
    this.overlay.classList.add('visible');
    this.bannerEl?.classList.add('visible');
    this.bannerEl?.removeAttribute('aria-hidden');
    this.hideTrigger();
    if (this.bannerEl && !this.previewMode) this.focusMgr.trapFocus(this.bannerEl);
    // Announce to screen readers
    this.liveRegion.textContent = this.translations.banner.title;
  }

  showPreferences(): void {
    if (!this.initialized || this.config.headless) return;
    this.hideBanner();
    this.ensurePreferences();
    this.lockBodyScroll();
    this.overlay.classList.add('visible');
    this.prefsEl?.classList.add('visible');
    this.prefsEl?.setAttribute('aria-modal', 'true');
    this.prefsEl?.removeAttribute('aria-hidden');
    this.hideTrigger();
    if (this.prefsEl && !this.previewMode) this.focusMgr.trapFocus(this.prefsEl);
    // Announce preferences dialog to screen readers
    this.liveRegion.textContent = this.translations.preferences.title;
  }

  hide(): void {
    if (!this.initialized) return;
    this.hideBanner();
    this.hidePreferences();
  }

  on(event: string, callback: (detail: ConsentEventDetail) => void): () => void {
    if (!this.initialized) {
      // Queue the listener and return an unsubscribe function that works even before init
      const entry: { event: string; callback: (detail: ConsentEventDetail) => void; unsubscribers: Array<() => void> } = {
        event,
        callback,
        unsubscribers: [],
      };
      this.pendingListeners.push(entry);
      return () => {
        // Remove from pending if not yet flushed
        const idx = this.pendingListeners.indexOf(entry);
        if (idx !== -1) {
          this.pendingListeners.splice(idx, 1);
        }
        // Unsubscribe if already registered
        for (const unsub of entry.unsubscribers) {
          unsub();
        }
      };
    }
    return this.events.on(event as ConsentEventType, callback);
  }

  reset(): void {
    if (!this.initialized) return;
    this.geoAbort?.abort();
    this.geoAbort = null;
    this.manager.reset();
    this.scriptGate.updateConsent({});
    this.gcm?.setDefaults();
    this.events.emit('consent:update', {
      consent: null,
      changed: [],
    });
    this.hideTrigger();
    this.hidePreferences();
    this.showBanner();
  }

  // --- Internal ---

  private destroy(): void {
    this.unlockBodyScroll();
    this.geoAbort?.abort();
    this.geoAbort = null;
    this.scriptGate?.destroy();
    this.events?.destroy();
    this.focusMgr?.destroy();
    // Clear timers
    if (this.gpcTimer) { clearTimeout(this.gpcTimer); this.gpcTimer = null; }
    if (this.gpcRemoveTimer) { clearTimeout(this.gpcRemoveTimer); this.gpcRemoveTimer = null; }
    if (this.geoTimer) { clearTimeout(this.geoTimer); this.geoTimer = null; }
    if (this.expiryTimer) { clearTimeout(this.expiryTimer); this.expiryTimer = null; }
    if (this.expiryRemoveTimer) { clearTimeout(this.expiryRemoveTimer); this.expiryRemoveTimer = null; }
    if (this.storageHandler) { window.removeEventListener('storage', this.storageHandler); this.storageHandler = null; }
    if (this.shortcutHandler) { document.removeEventListener('keydown', this.shortcutHandler); this.shortcutHandler = null; }
    for (const h of this.rafHandles) cancelAnimationFrame(h);
    this.rafHandles = [];
    // Remove UI elements from shadow DOM to prevent duplicates on reconnect
    this.bannerEl?.remove(); this.bannerEl = null;
    this.prefsEl?.remove(); this.prefsEl = null;
    this.triggerEl?.remove(); this.triggerEl = null;
    this.liveRegion?.remove();
    this.overlay?.remove();
    // Clean up transient notices (expiry, GPC) that may still be visible
    this.shadowRoot!.querySelectorAll('.cc-expiry-notice, .cc-banner').forEach(el => el.remove());
    this.shadowRoot!.querySelectorAll('style').forEach(s => s.remove());
    // Reset lifecycle state so connectedCallback can re-init after disconnect/reconnect
    this.initialized = false;
    this.pendingListeners = [];
  }

  private init(config: CookieConsentConfig): void {
    this.initialized = true;
    this.config = config;
    this.events = new EventBus(this);

    // Flush any event listeners that were registered before init
    for (const entry of this.pendingListeners) {
      const unsub = this.events.on(entry.event as ConsentEventType, entry.callback);
      entry.unsubscribers.push(unsub);
    }
    this.pendingListeners = [];

    // Restore user-selected language from localStorage (language selector persistence)
    let savedLang: string | null = null;
    try { savedLang = localStorage.getItem(LANG_STORAGE_KEY); } catch { /* SecurityError in sandboxed iframes */ }
    if (savedLang) config.language = savedLang;
    this.translations = resolveTranslations(config.language, config.translations);

    let categories = config.categories?.length ? config.categories : DEFAULT_CATEGORIES;

    // Validate and deduplicate category IDs
    const catIds = new Set<string>();
    categories = categories.filter((cat) => {
      if (!cat.id?.trim()) {
        console.error('[cookieproof] Category with empty ID — skipping.');
        return false;
      }
      if (catIds.has(cat.id)) {
        console.error(`[cookieproof] Duplicate category ID "${cat.id}" — skipping duplicate.`);
        return false;
      }
      catIds.add(cat.id);
      return true;
    });

    this.manager = new ConsentManager({ ...config, categories }, this.events);
    this.scriptGate = new ScriptGate(categories);

    // GCM bridge
    if (config.gcmEnabled) {
      this.gcm = new GCMBridge(config.gcmMapping, config.gcmWaitForUpdate);
      this.gcm.setDefaults();
    }

    // Cross-tab sync
    this.setupCrossTabSync();

    // Start blocking immediately (observer intercepts dynamic scripts before consent)
    this.scriptGate.startBlocking();

    // Headless mode: core systems are ready, skip all UI
    if (config.headless) {
      const { gpcApplied } = this.manager.init();
      if (gpcApplied) {
        const consent = this.manager.getConsent();
        if (consent) {
          this.scriptGate.updateConsent(consent.categories);
          this.gcm?.update(consent.categories);
          try { this.config.onReject?.(consent); } catch (e) { console.error('[cookieproof] onReject callback error:', e); }
        }
      } else {
        const consent = this.manager.getConsent();
        if (consent) {
          this.scriptGate.updateConsent(consent.categories);
          this.gcm?.update(consent.categories);
        }
      }
      // Keyboard shortcut still works in headless mode
      if (config.keyboardShortcut) this.setupKeyboardShortcut(config.keyboardShortcut);
      return;
    }

    // --- Headed mode: render UI ---

    this.focusMgr = new FocusManager(this.shadowRoot!);

    // Warn if critical translation strings are empty
    if (!this.translations.banner.title?.trim()) {
      console.warn('[cookieproof] banner.title is empty — dialog will not be labeled for screen readers.');
    }

    // Apply theme
    const theme = config.theme ?? 'light';
    this.setAttribute('data-theme', theme);

    // Render base structure
    const style = document.createElement('style');
    style.textContent = getStyles();
    this.overlay = document.createElement('div');
    this.overlay.className = 'cc-overlay';
    this.overlay.addEventListener('click', () => {
      if (this.bannerEl?.classList.contains('visible')) {
        // GDPR: dismissing the banner without a choice = no consent = reject
        this.rejectAll();
      } else if (this.prefsEl?.classList.contains('visible')) {
        this.hidePreferences();
        // Return to banner if no prior consent, otherwise show trigger
        if (this.manager.getConsent()) {
          this.showTrigger();
        } else {
          this.showBanner();
        }
      }
    });

    // Visually-hidden live region for screen reader announcements
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.setAttribute('role', 'status');
    Object.assign(this.liveRegion.style, {
      position: 'absolute', width: '1px', height: '1px',
      overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap',
    });

    this.shadowRoot!.append(style, this.overlay, this.liveRegion);

    // IMY compliance: ensure mandatory settings are in place before UI decisions
    this.checkComplianceOverrides(config);

    // Init consent state
    const { needsBanner, gpcApplied } = this.manager.init();

    if (gpcApplied) {
      // GPC auto-rejected — apply and show trigger for manual override
      const consent = this.manager.getConsent();
      if (consent) {
        this.scriptGate.updateConsent(consent.categories);
        this.gcm?.update(consent.categories);
        try { this.config.onReject?.(consent); } catch (e) { console.error('[cookieproof] onReject callback error:', e); }
      }
      this.showTrigger();
      // Briefly notify the user that GPC was honoured (GDPR transparency)
      this.showGPCNotice();
    } else if (needsBanner) {
      // Check geo endpoint before showing banner
      if (config.geoEndpoint) {
        this.checkGeo(config.geoEndpoint);
      } else {
        this.showBanner();
      }
    } else {
      const consent = this.manager.getConsent();
      if (consent) {
        this.scriptGate.updateConsent(consent.categories);
        this.gcm?.update(consent.categories);
      }
      // Show floating trigger for returning visitors
      this.showTrigger();
      // Check if consent is approaching expiry
      this.checkConsentExpiry();
    }

    // Keyboard shortcut
    if (config.keyboardShortcut) {
      this.setupKeyboardShortcut(config.keyboardShortcut);
    }
  }

  private rebuild(config: CookieConsentConfig): void {
    // Save current external listeners before destroy wipes them
    const savedListeners = this.events?.exportListeners() ?? null;

    this.destroy(); // destroy() now handles all DOM cleanup
    this.initialized = false;
    this.init(config);

    // Restore external listeners that were registered via on()
    if (savedListeners) {
      this.events.importListeners(savedListeners);
    }
  }

  private changeLanguage(lang: string): void {
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* SecurityError in sandboxed iframes */ }
    const wasShowingPrefs = this.prefsEl?.classList.contains('visible') ?? false;
    this.config = { ...this.config, language: lang };
    this.rebuild(this.config);
    if (wasShowingPrefs) this.showPreferences();
    else this.showBanner();
  }

  private getLanguageOptions(): { languages: string[]; current: string; names: Record<string, string>; onChange: (lang: string) => void } | undefined {
    const selector = this.config.languageSelector;
    if (!selector) return undefined;
    const languages = getAvailableLanguages(selector);
    if (languages.length < 2) return undefined;
    return {
      languages,
      current: this.config.language ?? detectLanguage(),
      names: LANGUAGE_NAMES,
      onChange: (lang: string) => this.changeLanguage(lang),
    };
  }

  private setupCrossTabSync(): void {
    const storageKey = this.manager.getStorageKey();
    this.storageHandler = (e: StorageEvent) => {
      if (e.key !== storageKey || !this.initialized) return;

      // Capture previous state for per-category event diffing
      const previousConsent = this.manager.getConsent();
      const previousCategories = previousConsent?.categories ?? {};

      const updated = this.manager.reload();
      if (updated) {
        this.scriptGate.updateConsent(updated.categories);
        this.gcm?.update(updated.categories);

        // Compute changed categories
        const changed: string[] = [];
        for (const key of Object.keys(updated.categories)) {
          if (updated.categories[key] !== (previousCategories[key] ?? false)) {
            changed.push(key);
          }
        }

        const detail: ConsentEventDetail = { consent: updated, changed };
        this.events.emit('consent:update', detail);
        for (const catId of changed) {
          this.events.emit(`consent:category:${catId}`, detail);
        }

        // Fire config callbacks so host-page side-effects stay in sync
        if (changed.length > 0) {
          try {
            if (updated.method === 'accept-all') this.config.onAccept?.(updated);
            else if (updated.method === 'reject-all' || updated.method === 'do-not-sell' || updated.method === 'gpc') this.config.onReject?.(updated);
            else this.config.onChange?.(updated, changed);
          } catch (e) { console.error('[cookieproof] Cross-tab callback error:', e); }
        }

        this.hideBanner();
        this.hidePreferences();
        this.showTrigger();
      } else {
        // Record was cleared (reset) in other tab
        const changed = Object.keys(previousCategories);
        const detail: ConsentEventDetail = { consent: null, changed };
        this.scriptGate.updateConsent({});
        this.gcm?.setDefaults();
        this.events.emit('consent:update', detail);
        for (const catId of changed) {
          this.events.emit(`consent:category:${catId}`, detail);
        }
        try {
          const resetRecord: ConsentRecord = {
            version: this.config.revision ?? 1,
            timestamp: Date.now(),
            method: 'reject-all',
            categories: Object.fromEntries(changed.map(k => [k, false])),
          };
          this.config.onReject?.(resetRecord);
        } catch (e) { console.error('[cookieproof] Cross-tab callback error:', e); }
        this.hideTrigger();
        this.showBanner();
      }
    };
    window.addEventListener('storage', this.storageHandler);
  }

  private setupKeyboardShortcut(shortcut: string): void {
    if (!shortcut?.trim()) return;
    const parts = shortcut.split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
    const key = parts.pop();
    if (!key) return;
    const mods = new Set(parts);

    this.shortcutHandler = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input or editable element
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      const matchKey = e.key.toLowerCase() === key;
      const matchAlt = mods.has('alt') === e.altKey;
      const matchCtrl = mods.has('ctrl') === (e.ctrlKey || e.metaKey);
      const matchShift = mods.has('shift') === e.shiftKey;
      // Ensure no extra modifiers pressed
      if (!mods.has('alt') && e.altKey) return;
      if (!mods.has('ctrl') && (e.ctrlKey || e.metaKey)) return;
      if (!mods.has('shift') && e.shiftKey) return;

      if (matchKey && matchAlt && matchCtrl && matchShift) {
        e.preventDefault();
        this.showPreferences();
      }
    };

    document.addEventListener('keydown', this.shortcutHandler);
  }

  private checkConsentExpiry(): void {
    const consent = this.manager.getConsent();
    if (!consent || consent.timestamp === 0) return;

    const expiryDays = this.config.cookieExpiry ?? 365;
    const notifyDays = this.config.expiryNotifyDays ?? 0; // disabled by default
    if (notifyDays <= 0) return;

    const expiresAt = consent.timestamp + expiryDays * 86_400_000;
    const notifyAt = expiresAt - notifyDays * 86_400_000;
    const now = Date.now();

    if (now >= notifyAt) {
      const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / 86_400_000));
      this.events.emit('consent:expiring' as ConsentEventType, {
        consent,
        changed: [],
        daysRemaining,
      });

      if (this.config.expiryNotifyUI) {
        this.showExpiryNotice(daysRemaining);
      }
    }
  }

  private showExpiryNotice(daysRemaining: number): void {
    if (this.config.headless) return;
    const notice = document.createElement('div');
    notice.className = 'cc-expiry-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');

    const p = document.createElement('p');
    Object.assign(p.style, { margin: '0', fontSize: '13px' });
    // Use i18n translation with {days} placeholder, fallback to English
    const expiryTemplate = this.translations.expiryNotice ?? 'Your cookie preferences expire in {days} days. Please review your settings.';
    p.textContent = daysRemaining > 0
      ? expiryTemplate.replace('{days}', String(daysRemaining))
      : 'Your cookie preferences have expired.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = this.translations.preferences?.save ? 'Renew' : 'Renew';
    Object.assign(btn.style, {
      marginLeft: '12px', cursor: 'pointer', background: 'none', border: 'none',
      color: 'var(--cc-btn-primary-bg)', fontWeight: '500', fontSize: '13px',
      textDecoration: 'underline', fontFamily: 'inherit',
    });
    btn.addEventListener('click', () => {
      notice.remove();
      this.showPreferences();
    });

    notice.append(p, btn);
    this.shadowRoot!.appendChild(notice);
    this.rafHandles.push(requestAnimationFrame(() => notice.classList.add('visible')));
    this.expiryTimer = setTimeout(() => {
      notice.classList.remove('visible');
      this.expiryRemoveTimer = setTimeout(() => notice.remove(), 300);
    }, 8000);
  }

  private ensureBanner(): void {
    if (this.bannerEl) return;
    this.bannerEl = createBanner(
      this.translations,
      this.config.position ?? 'bottom',
      {
        onAcceptAll: () => this.acceptAll(),
        onRejectAll: () => this.rejectAll(),
        onSettings: () => this.showPreferences(),
        onDoNotSell: () => this.doNotSell(),
      },
      this.config.privacyPolicyUrl,
      this.config,
      this.getLanguageOptions()
    );
    this.shadowRoot!.appendChild(this.bannerEl);
  }

  private ensurePreferences(): void {
    // Remove old prefs to rebuild with current state
    this.prefsEl?.remove();
    const consent = this.manager.getConsent();
    const categories = this.manager.getCategories();
    this.prefsEl = createPreferences(
      categories,
      consent?.categories ?? {},
      this.translations,
      {
        onSave: (selected) => {
          // Compute which categories actually changed before saving
          const previousConsent = this.manager.getConsent();
          const previousCategories = previousConsent?.categories ?? {};
          const changedKeys = Object.keys(selected).filter(
            (key) => selected[key] !== (previousCategories[key] ?? false)
          );

          const record = this.manager.setCategories(selected);
          this.scriptGate.updateConsent(record.categories);
          this.gcm?.update(record.categories);
          try { this.config.onChange?.(record, changedKeys); } catch (e) { console.error('[cookieproof] onChange callback error:', e); }
          this.hidePreferences();
          this.showTrigger();
        },
        onAcceptAll: () => this.acceptAll(),
        onRejectAll: () => this.rejectAll(),
        onClose: () => {
          this.hidePreferences();
          if (this.manager.getConsent()) {
            this.showTrigger();
          } else {
            this.showBanner();
          }
        },
      },
      this.config.privacyPolicyUrl,
      this.getLanguageOptions()
    );
    this.shadowRoot!.appendChild(this.prefsEl);
  }

  private hideBanner(): void {
    if (!this.initialized || this.config.headless) return;
    this.bannerEl?.classList.remove('visible');
    this.bannerEl?.setAttribute('aria-hidden', 'true');
    this.overlay.classList.remove('visible');
    this.focusMgr.releaseFocus();
    this.liveRegion.textContent = '';
  }

  private hidePreferences(): void {
    if (!this.initialized || this.config.headless) return;
    this.prefsEl?.classList.remove('visible');
    this.prefsEl?.setAttribute('aria-modal', 'false');
    this.prefsEl?.setAttribute('aria-hidden', 'true');
    this.overlay.classList.remove('visible');
    this.focusMgr.releaseFocus();
    this.unlockBodyScroll();
  }

  private showTrigger(): void {
    if (!this.initialized || this.config.headless) return;
    const triggerSetting = this.config.floatingTrigger ?? true;
    if (triggerSetting === false) return;

    if (!this.triggerEl) {
      const position = typeof triggerSetting === 'string' ? triggerSetting : 'left';
      this.triggerEl = createFloatingTrigger(
        position,
        this.translations.trigger.ariaLabel,
        () => this.showPreferences()
      );
      this.shadowRoot!.appendChild(this.triggerEl);
    }

    // Small delay for CSS transition
    this.rafHandles.push(requestAnimationFrame(() => {
      this.triggerEl?.classList.add('visible');
      this.triggerEl?.removeAttribute('aria-hidden');
      this.triggerEl?.setAttribute('tabindex', '0');
    }));
  }

  private hideTrigger(): void {
    if (!this.initialized || this.config.headless) return;
    this.triggerEl?.classList.remove('visible');
    this.triggerEl?.setAttribute('aria-hidden', 'true');
    this.triggerEl?.setAttribute('tabindex', '-1');
  }

  private savedBodyStyles: Record<string, string> = {};

  private lockBodyScroll(): void {
    this.savedScrollY = window.scrollY;
    const props = ['position', 'top', 'left', 'right', 'overflow'];
    for (const p of props) {
      this.savedBodyStyles[p] = document.body.style.getPropertyValue(p);
    }
    document.body.style.position = 'fixed';
    document.body.style.top = `-${this.savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    // Only restore scroll if body was actually locked (position: fixed).
    // Without this guard, destroy() during preview rebuilds would scroll
    // the configurator to the top on every update.
    if (document.body.style.position !== 'fixed') return;
    for (const [p, v] of Object.entries(this.savedBodyStyles)) {
      document.body.style.setProperty(p, v || '');
    }
    this.savedBodyStyles = {};
    window.scrollTo(0, this.savedScrollY);
  }

  private showGPCNotice(): void {
    if (this.config.headless) return;
    const notice = document.createElement('div');
    notice.className = 'cc-banner';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('data-position', this.config.position ?? 'bottom');
    // Use textContent (not innerHTML) to eliminate any XSS surface
    const p = document.createElement('p');
    Object.assign(p.style, { margin: '0', textAlign: 'center', color: 'var(--cc-text-secondary)', fontSize: '13px' });
    const gpcText = this.translations.gpcNotice ?? 'Global Privacy Control signal detected — non-essential cookies have been blocked.';
    p.textContent = '\u{1F6E1} ' + gpcText;
    notice.appendChild(p);
    this.shadowRoot!.appendChild(notice);
    // Animate in then auto-dismiss
    this.rafHandles.push(requestAnimationFrame(() => notice.classList.add('visible')));
    this.gpcTimer = setTimeout(() => {
      notice.classList.remove('visible');
      this.gpcRemoveTimer = setTimeout(() => notice.remove(), 300);
    }, 4000);
  }

  private checkGeo(endpoint: string): void {
    // Only allow HTTPS endpoints to prevent SSRF
    if (!/^https:\/\//i.test(endpoint)) {
      console.warn('[cookieproof] geoEndpoint must use HTTPS');
      this.showBanner();
      return;
    }
    this.geoAbort?.abort();
    this.geoAbort = new AbortController();
    if (this.geoTimer) { clearTimeout(this.geoTimer); this.geoTimer = null; }
    this.geoTimer = setTimeout(() => this.geoAbort?.abort(), 3000);

    fetch(endpoint, { signal: this.geoAbort.signal })
      .then((res) => {
        if (!res.ok) throw new Error('geo');
        return res.json();
      })
      .then((data: unknown) => {
        if (this.geoTimer) { clearTimeout(this.geoTimer); this.geoTimer = null; }
        if (!this.isConnected) return;
        // Strictly validate the response shape — only skip banner when
        // the server explicitly returns { requiresConsent: false }.
        if (
          data && typeof data === 'object' && !Array.isArray(data) &&
          (data as Record<string, unknown>).requiresConsent === false
        ) {
          // Region doesn't require consent — auto-accept all
          this.acceptAll();
        } else {
          this.showBanner();
        }
      })
      .catch(() => {
        if (this.geoTimer) { clearTimeout(this.geoTimer); this.geoTimer = null; }
        // Fail-safe: show banner if geo check fails — but only if still mounted
        if (!this.isConnected) return;
        this.showBanner();
      });
  }

  private checkComplianceOverrides(config: CookieConsentConfig): void {
    if (config.floatingTrigger === false) {
      console.warn(
        '[cookieproof] IMY 2026 / GDPR Art 7(3): floatingTrigger was set to false but has been ' +
        'forced to "left". Users must have a way to change their consent at any time. ' +
        'Override this by providing your own consent-change UI and setting floatingTrigger to "left" or "right".'
      );
      // Avoid mutating the caller's config object — write to our own copy
      this.config = { ...this.config, floatingTrigger: 'left' };
    }
  }
}
