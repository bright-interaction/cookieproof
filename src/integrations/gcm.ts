import type { GCMSignal } from '../core/types.js';
import { DEFAULT_GCM_MAPPING } from '../core/constants.js';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// gtag pushes the `arguments` object (not an array) to dataLayer.
// Google Tag Manager and GA4 rely on this exact shape.
function gtag(_command: string, ..._args: unknown[]): void {
  window.dataLayer = window.dataLayer ?? [];
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

// Ensure gtag function exists on window
function ensureGtag(): void {
  if (typeof window.gtag !== 'function') {
    window.gtag = function () {
      window.dataLayer = window.dataLayer ?? [];
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }
}

export class GCMBridge {
  private mapping: Record<string, GCMSignal[]>;
  private waitForUpdate: number;
  private defaultsSet = false;

  constructor(customMapping?: Record<string, GCMSignal[]>, waitForUpdate?: number) {
    this.mapping = customMapping ?? DEFAULT_GCM_MAPPING;
    this.waitForUpdate = waitForUpdate ?? 2500; // Google-recommended default
  }

  /** Set all consent signals to 'denied' (call on page load, before any tags) */
  setDefaults(): void {
    this.defaultsSet = true;
    ensureGtag();

    const defaults: Record<string, string | number> = {};
    // Enumerate all 7 GCM V2 signals explicitly to ensure none are missed
    const ALL_SIGNALS: GCMSignal[] = [
      'ad_storage', 'analytics_storage', 'ad_user_data',
      'ad_personalization', 'functionality_storage',
      'personalization_storage', 'security_storage',
    ];

    for (const signal of ALL_SIGNALS) {
      defaults[signal] = signal === 'security_storage' ? 'granted' : 'denied';
    }

    // GCM V2: tell Google tags to wait for an update before firing
    defaults['wait_for_update'] = this.waitForUpdate;

    gtag('consent', 'default', defaults);
  }

  /** Update consent signals based on category consent state */
  update(categories: Record<string, boolean>): void {
    if (!this.defaultsSet) {
      console.warn('[cookieproof] GCMBridge.update() called before setDefaults() — calling setDefaults() automatically.');
      this.setDefaults();
    }
    ensureGtag();

    const update: Record<string, string> = {};
    for (const [category, signals] of Object.entries(this.mapping)) {
      const granted = categories[category] === true;
      for (const signal of signals) {
        // If multiple categories map to the same signal, grant wins
        if (granted || update[signal] !== 'granted') {
          update[signal] = granted ? 'granted' : 'denied';
        }
      }
    }

    update['security_storage'] = 'granted';
    gtag('consent', 'update', update);

    // Persist resolved signals so the loader can push GCM on returning visits
    // without loading the full UMD bundle
    try { localStorage.setItem('ce_signals', JSON.stringify(update)); } catch { /* ignore */ }
  }
}
