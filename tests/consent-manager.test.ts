import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConsentManager } from '../src/core/consent-manager.js';
import { EventBus } from '../src/core/events.js';
import { DEFAULT_CATEGORIES } from '../src/core/constants.js';
import type { CookieConsentConfig, CategoryConfig, ConsentEventDetail } from '../src/core/types.js';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function makeEvents(): EventBus {
  return new EventBus(new EventTarget());
}

function makeManager(config: CookieConsentConfig = {}, events?: EventBus): ConsentManager {
  return new ConsentManager(config, events ?? makeEvents());
}

// ─────────────────────────────────────────────────────────
// init()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.init()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns needsBanner=true and gpcApplied=false on first visit', () => {
    const mgr = makeManager();
    const result = mgr.init();
    expect(result.needsBanner).toBe(true);
    expect(result.gpcApplied).toBe(false);
  });

  it('returns needsBanner=false when a valid prior consent is stored', () => {
    const mgr1 = makeManager();
    mgr1.init();
    mgr1.acceptAll();

    const mgr2 = makeManager();
    const result = mgr2.init();
    expect(result.needsBanner).toBe(false);
  });

  it('emits consent:init on every call', () => {
    const events = makeEvents();
    const listener = vi.fn();
    events.on('consent:init', listener);

    const mgr = makeManager({}, events);
    mgr.init();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('getConsent() returns null after init without prior consent', () => {
    const mgr = makeManager();
    mgr.init();
    expect(mgr.getConsent()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// Revision mismatch
// ─────────────────────────────────────────────────────────
describe('ConsentManager — revision mismatch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns needsBanner=true when stored consent has a different revision', () => {
    const mgr1 = makeManager({ revision: 1 });
    mgr1.init();
    mgr1.acceptAll();

    const mgr2 = makeManager({ revision: 2 });
    const { needsBanner } = mgr2.init();
    expect(needsBanner).toBe(true);
  });

  it('clears stored consent when revision changes', () => {
    const mgr1 = makeManager({ revision: 1 });
    mgr1.init();
    mgr1.acceptAll();

    const mgr2 = makeManager({ revision: 2 });
    mgr2.init();
    expect(mgr2.getConsent()).toBeNull();
  });

  it('does not re-prompt when revision matches', () => {
    const mgr1 = makeManager({ revision: 3 });
    mgr1.init();
    mgr1.acceptAll();

    const mgr2 = makeManager({ revision: 3 });
    const { needsBanner } = mgr2.init();
    expect(needsBanner).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// acceptAll()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.acceptAll()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a record with method="accept-all"', () => {
    const mgr = makeManager();
    mgr.init();
    expect(mgr.acceptAll().method).toBe('accept-all');
  });

  it('sets all default categories to true', () => {
    const mgr = makeManager();
    mgr.init();
    const record = mgr.acceptAll();

    for (const cat of DEFAULT_CATEGORIES) {
      expect(record.categories[cat.id]).toBe(true);
    }
  });

  it('persists across a second instance', () => {
    const mgr1 = makeManager();
    mgr1.init();
    mgr1.acceptAll();

    const mgr2 = makeManager();
    mgr2.init();
    expect(mgr2.getConsent()?.method).toBe('accept-all');
  });

  it('emits consent:accept-all event', () => {
    const events = makeEvents();
    const listener = vi.fn();
    events.on('consent:accept-all', listener);

    const mgr = makeManager({}, events);
    mgr.init();
    mgr.acceptAll();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits consent:update event', () => {
    const events = makeEvents();
    const listener = vi.fn();
    events.on('consent:update', listener);

    const mgr = makeManager({}, events);
    mgr.init();
    mgr.acceptAll();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits consent:update with changed categories listed', () => {
    const events = makeEvents();
    const updateListener = vi.fn();
    events.on('consent:update', updateListener);

    const mgr = makeManager({}, events);
    mgr.init();
    mgr.acceptAll();

    const detail: ConsentEventDetail = updateListener.mock.calls[0][0];
    // analytics, marketing, preferences were false by default, so they changed
    expect(detail.changed).toContain('analytics');
    expect(detail.changed).toContain('marketing');
    expect(detail.changed).toContain('preferences');
  });
});

// ─────────────────────────────────────────────────────────
// rejectAll()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.rejectAll()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a record with method="reject-all"', () => {
    const mgr = makeManager();
    mgr.init();
    expect(mgr.rejectAll().method).toBe('reject-all');
  });

  it('sets only required categories to true, others to false', () => {
    const mgr = makeManager();
    mgr.init();
    const record = mgr.rejectAll();

    expect(record.categories.necessary).toBe(true);   // required
    expect(record.categories.analytics).toBe(false);
    expect(record.categories.marketing).toBe(false);
    expect(record.categories.preferences).toBe(false);
  });

  it('emits consent:reject-all event', () => {
    const events = makeEvents();
    const listener = vi.fn();
    events.on('consent:reject-all', listener);

    const mgr = makeManager({}, events);
    mgr.init();
    mgr.rejectAll();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits consent:update event', () => {
    const events = makeEvents();
    const listener = vi.fn();
    events.on('consent:update', listener);

    const mgr = makeManager({}, events);
    mgr.init();
    mgr.rejectAll();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────
// setCategories()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.setCategories()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a record with method="custom"', () => {
    const mgr = makeManager();
    mgr.init();
    expect(mgr.setCategories({ analytics: true }).method).toBe('custom');
  });

  it('sets optional categories according to the selection', () => {
    const mgr = makeManager();
    mgr.init();
    const record = mgr.setCategories({ analytics: true, marketing: false, preferences: true });

    expect(record.categories.analytics).toBe(true);
    expect(record.categories.marketing).toBe(false);
    expect(record.categories.preferences).toBe(true);
  });

  it('always sets required categories to true regardless of selection', () => {
    const mgr = makeManager();
    mgr.init();
    const record = mgr.setCategories({ necessary: false, analytics: true });

    expect(record.categories.necessary).toBe(true);
  });

  it('treats an unspecified optional category as false', () => {
    const mgr = makeManager();
    mgr.init();
    // analytics not mentioned — should be treated as false
    const record = mgr.setCategories({ marketing: true });
    expect(record.categories.analytics).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// acceptCategory() / rejectCategory()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.acceptCategory() / rejectCategory()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('acceptCategory updates the specified category to true', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.rejectAll();
    mgr.acceptCategory('analytics');

    expect(mgr.getConsent()?.categories.analytics).toBe(true);
  });

  it('acceptCategory does not modify other categories', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.rejectAll();
    mgr.acceptCategory('analytics');

    expect(mgr.getConsent()?.categories.marketing).toBe(false);
  });

  it('acceptCategory is a no-op when there is no existing record', () => {
    const mgr = makeManager();
    mgr.init();
    expect(() => mgr.acceptCategory('analytics')).not.toThrow();
    expect(mgr.getConsent()).toBeNull();
  });

  it('rejectCategory updates the specified optional category to false', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.acceptAll();
    mgr.rejectCategory('analytics');

    expect(mgr.getConsent()?.categories.analytics).toBe(false);
  });

  it('rejectCategory does not affect other categories', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.acceptAll();
    mgr.rejectCategory('analytics');

    expect(mgr.getConsent()?.categories.marketing).toBe(true);
  });

  it('rejectCategory cannot reject a required category', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.acceptAll();
    mgr.rejectCategory('necessary');

    expect(mgr.getConsent()?.categories.necessary).toBe(true);
  });

  it('rejectCategory is a no-op when there is no existing record', () => {
    const mgr = makeManager();
    mgr.init();
    expect(() => mgr.rejectCategory('analytics')).not.toThrow();
    expect(mgr.getConsent()).toBeNull();
  });

  it('emits consent:category:<id> event on acceptCategory', () => {
    const events = makeEvents();
    const mgr = makeManager({}, events);
    mgr.init();
    mgr.rejectAll();

    // Register listener AFTER rejectAll so we only capture the acceptCategory event
    const listener = vi.fn();
    events.on('consent:category:analytics', listener);
    mgr.acceptCategory('analytics');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────
// hasConsent()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.hasConsent()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false for all categories when no consent is recorded', () => {
    const mgr = makeManager();
    mgr.init();
    expect(mgr.hasConsent('analytics')).toBe(false);
    expect(mgr.hasConsent('marketing')).toBe(false);
  });

  it('returns true for a required category even if the record only has required=true', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.rejectAll(); // necessary is true, analytics is false
    expect(mgr.hasConsent('necessary')).toBe(true);
  });

  it('returns true for an optional category when it was explicitly accepted', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.setCategories({ analytics: true });
    expect(mgr.hasConsent('analytics')).toBe(true);
  });

  it('returns false for an optional category that was rejected', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.setCategories({ analytics: false });
    expect(mgr.hasConsent('analytics')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// reset()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.reset()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears the in-memory consent record', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.acceptAll();
    mgr.reset();
    expect(mgr.getConsent()).toBeNull();
  });

  it('clears the persisted record so a fresh instance also has no consent', () => {
    const mgr1 = makeManager();
    mgr1.init();
    mgr1.acceptAll();
    mgr1.reset();

    const mgr2 = makeManager();
    const { needsBanner } = mgr2.init();
    expect(needsBanner).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// GPC (Global Privacy Control)
// ─────────────────────────────────────────────────────────
describe('ConsentManager — GPC detection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    // Remove GPC mock from navigator
    try {
      delete (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
    } catch {
      // read-only in some environments — ignore
    }
  });

  it('applies GPC auto-reject when navigator.globalPrivacyControl is true', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: true,
    });

    const mgr = makeManager({ respectGPC: true });
    const result = mgr.init();

    expect(result.gpcApplied).toBe(true);
    expect(result.needsBanner).toBe(false);
  });

  it('GPC record has method="gpc"', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: true,
    });

    const mgr = makeManager({ respectGPC: true });
    mgr.init();

    expect(mgr.getConsent()?.method).toBe('gpc');
  });

  it('GPC record only grants required categories', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: true,
    });

    const mgr = makeManager({ respectGPC: true });
    mgr.init();

    const record = mgr.getConsent();
    expect(record?.categories.necessary).toBe(true);
    expect(record?.categories.analytics).toBe(false);
    expect(record?.categories.marketing).toBe(false);
  });

  it('does not apply GPC when respectGPC=false', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: true,
    });

    const mgr = makeManager({ respectGPC: false });
    const result = mgr.init();

    expect(result.gpcApplied).toBe(false);
    expect(result.needsBanner).toBe(true);
  });

  it('does not apply GPC when navigator.globalPrivacyControl is false', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: false,
      configurable: true,
      writable: true,
    });

    const mgr = makeManager({ respectGPC: true });
    const result = mgr.init();

    expect(result.gpcApplied).toBe(false);
  });

  it('does not apply GPC when a prior consent record already exists', () => {
    // Save a prior consent record first
    const mgr1 = makeManager();
    mgr1.init();
    mgr1.acceptAll();

    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: true,
    });

    const mgr2 = makeManager({ respectGPC: true });
    const result = mgr2.init();

    expect(result.gpcApplied).toBe(false);
    expect(result.needsBanner).toBe(false); // prior consent exists
  });

  it('emits consent:gpc event when GPC is applied', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      value: true,
      configurable: true,
      writable: true,
    });

    const events = makeEvents();
    const listener = vi.fn();
    events.on('consent:gpc', listener);

    const mgr = makeManager({ respectGPC: true }, events);
    mgr.init();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────
// Custom categories
// ─────────────────────────────────────────────────────────
describe('ConsentManager — custom categories', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const customCategories: CategoryConfig[] = [
    { id: 'essential', required: true },
    { id: 'stats', required: false },
    { id: 'ads', required: false },
  ];

  it('uses custom categories when provided', () => {
    const mgr = makeManager({ categories: customCategories });
    mgr.init();
    const cats = mgr.getCategories();
    expect(cats.map((c) => c.id)).toEqual(['essential', 'stats', 'ads']);
  });

  it('acceptAll sets all custom categories to true', () => {
    const mgr = makeManager({ categories: customCategories });
    mgr.init();
    const record = mgr.acceptAll();

    expect(record.categories.essential).toBe(true);
    expect(record.categories.stats).toBe(true);
    expect(record.categories.ads).toBe(true);
  });

  it('rejectAll only sets required custom categories to true', () => {
    const mgr = makeManager({ categories: customCategories });
    mgr.init();
    const record = mgr.rejectAll();

    expect(record.categories.essential).toBe(true);
    expect(record.categories.stats).toBe(false);
    expect(record.categories.ads).toBe(false);
  });

  it('uses DEFAULT_CATEGORIES when categories config is empty', () => {
    const mgr = makeManager({ categories: [] });
    const cats = mgr.getCategories();
    expect(cats.map((c) => c.id)).toEqual(DEFAULT_CATEGORIES.map((c) => c.id));
  });
});

// ─────────────────────────────────────────────────────────
// doNotSell()
// ─────────────────────────────────────────────────────────
describe('ConsentManager.doNotSell()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a record with method="do-not-sell"', () => {
    const mgr = makeManager();
    mgr.init();
    expect(mgr.doNotSell().method).toBe('do-not-sell');
  });

  it('sets marketing to false and keeps required categories true', () => {
    const mgr = makeManager();
    mgr.init();
    const record = mgr.doNotSell();
    expect(record.categories.necessary).toBe(true);
    expect(record.categories.marketing).toBe(false);
  });

  it('preserves non-marketing consent state for optional categories', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.acceptAll(); // analytics=true, preferences=true
    const record = mgr.doNotSell();
    expect(record.categories.analytics).toBe(true);
    expect(record.categories.preferences).toBe(true);
    expect(record.categories.marketing).toBe(false);
  });

  it('defaults non-marketing optional categories to false when no prior consent', () => {
    const mgr = makeManager();
    mgr.init();
    const record = mgr.doNotSell();
    expect(record.categories.analytics).toBe(false);
    expect(record.categories.preferences).toBe(false);
  });

  it('persists the record across instances', () => {
    const mgr1 = makeManager();
    mgr1.init();
    mgr1.doNotSell();

    const mgr2 = makeManager();
    mgr2.init();
    expect(mgr2.getConsent()?.method).toBe('do-not-sell');
  });
});

// ─────────────────────────────────────────────────────────
// proofEndpoint HTTPS validation
// ─────────────────────────────────────────────────────────
describe('ConsentManager — proofEndpoint validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts HTTPS proofEndpoint', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    // sendBeacon should have been called (endpoint accepted)
    expect(beaconSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    beaconSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('rejects HTTP proofEndpoint and logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({ proofEndpoint: 'http://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    // sendBeacon should NOT have been called (endpoint rejected)
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('proofEndpoint must use HTTPS')
    );

    beaconSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('rejects javascript: proofEndpoint', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({ proofEndpoint: 'javascript:alert(1)' });
    mgr.init();
    mgr.acceptAll();

    expect(beaconSpy).not.toHaveBeenCalled();

    beaconSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('handles undefined proofEndpoint gracefully (no beacon sent)', () => {
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({}); // no proofEndpoint
    mgr.init();
    mgr.acceptAll();

    expect(beaconSpy).not.toHaveBeenCalled();

    beaconSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────
// Proof queue resilience
// ─────────────────────────────────────────────────────────
describe('ConsentManager — proof queue', () => {
  const QUEUE_KEY = 'ce_proof_queue';

  beforeEach(() => {
    localStorage.clear();
  });

  it('enqueues proof when sendBeacon fails', () => {
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    const raw = localStorage.getItem(QUEUE_KEY);
    expect(raw).not.toBeNull();
    const queue = JSON.parse(raw!);
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBeGreaterThanOrEqual(1);

    beaconSpy.mockRestore();
  });

  it('flushes queued proofs on next sendProof call', () => {
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll(); // This enqueues

    const queueBefore = JSON.parse(localStorage.getItem(QUEUE_KEY)!);
    expect(queueBefore.length).toBeGreaterThanOrEqual(1);

    // Now sendBeacon succeeds
    beaconSpy.mockReturnValue(true);
    mgr.rejectAll(); // This triggers sendProof + flushQueue

    // Queue should be cleared since all were successfully sent
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();

    beaconSpy.mockRestore();
  });

  it('clears corrupted queue data (non-array JSON)', () => {
    localStorage.setItem(QUEUE_KEY, '"not-an-array"');
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    // Should not throw, corrupted data should be cleaned up
    const raw = localStorage.getItem(QUEUE_KEY);
    // Queue should be cleared (corrupted data gone, new proof sent via beacon)
    expect(raw).toBeNull();

    beaconSpy.mockRestore();
  });

  it('clears corrupted queue data (invalid JSON)', () => {
    localStorage.setItem(QUEUE_KEY, '{{{not-json');
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    // Should not throw
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();

    beaconSpy.mockRestore();
  });

  it('filters non-string items from corrupted queue', () => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([42, null, 'valid-payload', { bad: true }]));
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    const raw = localStorage.getItem(QUEUE_KEY);
    const queue = JSON.parse(raw!);
    // Only string items should remain, plus the new proof
    for (const item of queue) {
      expect(typeof item).toBe('string');
    }

    beaconSpy.mockRestore();
  });

  it('caps queue at 50 items, dropping oldest', () => {
    // Pre-fill with 50 items
    const existingQueue = Array.from({ length: 50 }, (_, i) => `payload-${i}`);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(existingQueue));
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    const raw = localStorage.getItem(QUEUE_KEY);
    const queue = JSON.parse(raw!);
    expect(queue.length).toBeLessThanOrEqual(50);
    // payload-0 (the oldest) should have been dropped
    expect(queue.includes('payload-0')).toBe(false);

    beaconSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('sends revocation proof on reset()', () => {
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    const mgr = makeManager({ proofEndpoint: 'https://proof.example.com/api/proof' });
    mgr.init();
    mgr.acceptAll();

    const callsBefore = beaconSpy.mock.calls.length;
    mgr.reset();

    // Should have sent one more beacon for the revocation proof
    expect(beaconSpy.mock.calls.length).toBe(callsBefore + 1);

    beaconSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────
// getConsent() returns a copy
// ─────────────────────────────────────────────────────────
describe('ConsentManager.getConsent() — immutability', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a copy, so mutating the result does not affect internal state', () => {
    const mgr = makeManager();
    mgr.init();
    mgr.rejectAll();

    const consent = mgr.getConsent()!;
    consent.categories.analytics = true; // mutate the copy

    // Internal state should be unchanged
    expect(mgr.getConsent()?.categories.analytics).toBe(false);
  });
});
