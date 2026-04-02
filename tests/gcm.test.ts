import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GCMBridge } from '../src/integrations/gcm.js';
import { DEFAULT_GCM_MAPPING } from '../src/core/constants.js';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/** Read the last item pushed to window.dataLayer and return the second argument
 *  (the consent command argument object). The gtag function pushes an arguments
 *  object, so we access it like an array-like rather than a plain object.
 */
function lastDataLayerEntry(): IArguments | unknown[] {
  const dl = (window as Window & { dataLayer?: unknown[] }).dataLayer;
  if (!dl || dl.length === 0) throw new Error('dataLayer is empty');
  return dl[dl.length - 1] as IArguments | unknown[];
}

function lastConsentArgs(): [string, string, Record<string, string>] {
  const entry = lastDataLayerEntry() as ArrayLike<unknown>;
  return [entry[0] as string, entry[1] as string, entry[2] as Record<string, string>];
}

// ─────────────────────────────────────────────────────────
// GCMBridge.setDefaults()
// ─────────────────────────────────────────────────────────
describe('GCMBridge.setDefaults()', () => {
  beforeEach(() => {
    // Reset dataLayer and gtag before each test
    (window as Window & { dataLayer?: unknown[]; gtag?: unknown }).dataLayer = [];
    delete (window as Window & { gtag?: unknown }).gtag;
  });

  it('creates window.dataLayer if it does not exist', () => {
    delete (window as Window & { dataLayer?: unknown[] }).dataLayer;
    const bridge = new GCMBridge();
    bridge.setDefaults();
    expect(Array.isArray(window.dataLayer)).toBe(true);
  });

  it('installs window.gtag if it does not exist', () => {
    const bridge = new GCMBridge();
    bridge.setDefaults();
    expect(typeof window.gtag).toBe('function');
  });

  it('pushes a consent "default" entry onto dataLayer', () => {
    const bridge = new GCMBridge();
    bridge.setDefaults();

    const [cmd, subCmd] = lastConsentArgs();
    expect(cmd).toBe('consent');
    expect(subCmd).toBe('default');
  });

  it('sets all signals derived from DEFAULT_GCM_MAPPING to "denied"', () => {
    const bridge = new GCMBridge();
    bridge.setDefaults();

    const [, , signals] = lastConsentArgs();

    // Collect every signal that appears in the default mapping
    // (security_storage is always 'granted' — tested separately below)
    const expectedSignals = new Set<string>();
    for (const sigs of Object.values(DEFAULT_GCM_MAPPING)) {
      for (const s of sigs) expectedSignals.add(s);
    }
    expectedSignals.delete('security_storage');

    for (const signal of expectedSignals) {
      expect(signals[signal]).toBe('denied');
    }
  });

  it('sets security_storage to "granted" regardless of mapping', () => {
    const bridge = new GCMBridge();
    bridge.setDefaults();

    const [, , signals] = lastConsentArgs();
    expect(signals['security_storage']).toBe('granted');
  });

  it('respects a custom mapping — all 7 GCM V2 signals are still present with correct defaults', () => {
    const customMapping = {
      analytics: ['analytics_storage' as const],
    };
    const bridge = new GCMBridge(customMapping);
    bridge.setDefaults();

    const [, , signals] = lastConsentArgs();
    expect(signals['analytics_storage']).toBe('denied');
    // GCM V2 requires all signals to be explicitly set, even if not in custom mapping
    expect(signals['ad_storage']).toBe('denied');
    expect(signals['security_storage']).toBe('granted');
    expect(signals['wait_for_update']).toBe(2500);
  });
});

// ─────────────────────────────────────────────────────────
// GCMBridge.update()
// ─────────────────────────────────────────────────────────
describe('GCMBridge.update()', () => {
  beforeEach(() => {
    (window as Window & { dataLayer?: unknown[]; gtag?: unknown }).dataLayer = [];
    delete (window as Window & { gtag?: unknown }).gtag;
  });

  it('pushes a consent "update" entry onto dataLayer', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: true, marketing: false, preferences: false });

    const [cmd, subCmd] = lastConsentArgs();
    expect(cmd).toBe('consent');
    expect(subCmd).toBe('update');
  });

  it('maps analytics=true to analytics_storage="granted"', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: true, marketing: false, preferences: false });

    const [, , signals] = lastConsentArgs();
    expect(signals['analytics_storage']).toBe('granted');
  });

  it('maps analytics=false to analytics_storage="denied"', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: false, marketing: false, preferences: false });

    const [, , signals] = lastConsentArgs();
    expect(signals['analytics_storage']).toBe('denied');
  });

  it('maps marketing=true to ad_storage, ad_user_data, ad_personalization all "granted"', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: false, marketing: true, preferences: false });

    const [, , signals] = lastConsentArgs();
    expect(signals['ad_storage']).toBe('granted');
    expect(signals['ad_user_data']).toBe('granted');
    expect(signals['ad_personalization']).toBe('granted');
  });

  it('maps marketing=false to ad_storage, ad_user_data, ad_personalization all "denied"', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: false, marketing: false, preferences: false });

    const [, , signals] = lastConsentArgs();
    expect(signals['ad_storage']).toBe('denied');
    expect(signals['ad_user_data']).toBe('denied');
    expect(signals['ad_personalization']).toBe('denied');
  });

  it('maps preferences=true to functionality_storage and personalization_storage "granted"', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: false, marketing: false, preferences: true });

    const [, , signals] = lastConsentArgs();
    expect(signals['functionality_storage']).toBe('granted');
    expect(signals['personalization_storage']).toBe('granted');
  });

  it('maps all categories to their correct signals when all are granted', () => {
    const bridge = new GCMBridge();
    bridge.update({ analytics: true, marketing: true, preferences: true });

    const [, , signals] = lastConsentArgs();
    expect(signals['analytics_storage']).toBe('granted');
    expect(signals['ad_storage']).toBe('granted');
    expect(signals['ad_user_data']).toBe('granted');
    expect(signals['ad_personalization']).toBe('granted');
    expect(signals['functionality_storage']).toBe('granted');
    expect(signals['personalization_storage']).toBe('granted');
  });

  it('applies grant-wins logic: if two categories share a signal, granted takes precedence', () => {
    // Create a custom mapping where two categories share a signal
    const customMapping = {
      catA: ['analytics_storage' as const],
      catB: ['analytics_storage' as const],
    };
    const bridge = new GCMBridge(customMapping);

    // catA=false, catB=true — the signal should be "granted" because catB wins
    bridge.update({ catA: false, catB: true });

    const [, , signals] = lastConsentArgs();
    expect(signals['analytics_storage']).toBe('granted');
  });

  it('grant-wins: if both categories are denied, signal remains "denied"', () => {
    const customMapping = {
      catA: ['analytics_storage' as const],
      catB: ['analytics_storage' as const],
    };
    const bridge = new GCMBridge(customMapping);

    bridge.update({ catA: false, catB: false });

    const [, , signals] = lastConsentArgs();
    expect(signals['analytics_storage']).toBe('denied');
  });

  it('categories not in mapping are ignored', () => {
    const bridge = new GCMBridge();
    // 'necessary' is not in the DEFAULT_GCM_MAPPING, it should not appear
    bridge.update({ analytics: false, marketing: false, preferences: false, necessary: true });

    const [, , signals] = lastConsentArgs();
    expect('necessary' in signals).toBe(false);
  });
});
