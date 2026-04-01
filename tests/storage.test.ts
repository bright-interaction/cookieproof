import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StorageAdapter } from '../src/core/storage.js';
import { STORAGE_KEY, COOKIE_NAME } from '../src/core/constants.js';
import type { ConsentRecord } from '../src/core/types.js';

const validRecord: ConsentRecord = {
  version: 1,
  timestamp: 1700000000000,
  categories: { necessary: true, analytics: false, marketing: false },
  method: 'reject-all',
};

// ─────────────────────────────────────────────────────────
// localStorage mode
// ─────────────────────────────────────────────────────────
describe('StorageAdapter — localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when storage is empty', () => {
    const adapter = new StorageAdapter('localStorage');
    expect(adapter.load()).toBeNull();
  });

  it('saves and loads a valid record using the default key', () => {
    const adapter = new StorageAdapter('localStorage');
    adapter.save(validRecord);
    expect(adapter.load()).toEqual(validRecord);
  });

  it('uses the default STORAGE_KEY when no cookieName is given', () => {
    const adapter = new StorageAdapter('localStorage');
    adapter.save(validRecord);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('uses a custom cookieName as the localStorage key', () => {
    const adapter = new StorageAdapter('localStorage', 'my_consent');
    adapter.save(validRecord);
    expect(localStorage.getItem('my_consent')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clear removes the stored record', () => {
    const adapter = new StorageAdapter('localStorage');
    adapter.save(validRecord);
    adapter.clear();
    expect(adapter.load()).toBeNull();
  });

  it('clear removes the correct key when a custom cookieName is used', () => {
    const adapter = new StorageAdapter('localStorage', 'custom_key');
    adapter.save(validRecord);
    adapter.clear();
    expect(localStorage.getItem('custom_key')).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
    const adapter = new StorageAdapter('localStorage');
    expect(adapter.load()).toBeNull();
  });

  it('returns null for empty string value', () => {
    localStorage.setItem(STORAGE_KEY, '');
    const adapter = new StorageAdapter('localStorage');
    expect(adapter.load()).toBeNull();
  });

  it('falls back to cookie when localStorage throws QuotaExceededError', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    });

    // Should not throw — falls back silently
    const adapter = new StorageAdapter('localStorage');
    expect(() => adapter.save(validRecord)).not.toThrow();

    setItemSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────
// Cookie mode
// ─────────────────────────────────────────────────────────
describe('StorageAdapter — cookie', () => {
  beforeEach(() => {
    // Reset cookies by expiring any existing consent cookie
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = `my_cookie_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it('returns null when no cookie is present', () => {
    const adapter = new StorageAdapter('cookie');
    expect(adapter.load()).toBeNull();
  });

  it('saves and loads a valid record via cookie', () => {
    const adapter = new StorageAdapter('cookie');
    adapter.save(validRecord);
    const loaded = adapter.load();
    expect(loaded).toEqual(validRecord);
  });

  it('uses a custom cookieName', () => {
    const adapter = new StorageAdapter('cookie', 'my_cookie_consent');
    adapter.save(validRecord);
    expect(document.cookie).toContain('my_cookie_consent=');
  });

  it('clear removes the cookie', () => {
    const adapter = new StorageAdapter('cookie');
    adapter.save(validRecord);
    adapter.clear();
    expect(adapter.load()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// isValidRecord (tested through load())
// ─────────────────────────────────────────────────────────
describe('StorageAdapter — record validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const store = (obj: unknown) =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));

  it('rejects a record with no fields', () => {
    store({});
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record missing version', () => {
    store({ timestamp: 1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record missing timestamp', () => {
    store({ version: 1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record missing categories', () => {
    store({ version: 1, timestamp: 1, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record where categories is an array', () => {
    store({ version: 1, timestamp: 1, categories: ['necessary'], method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record where categories is null', () => {
    store({ version: 1, timestamp: 1, categories: null, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record with an invalid method value', () => {
    store({ version: 1, timestamp: 1, categories: { necessary: true }, method: 'auto' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a record with a non-string method', () => {
    store({ version: 1, timestamp: 1, categories: { necessary: true }, method: 42 });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('accepts all valid method values', () => {
    const methods: ConsentRecord['method'][] = ['accept-all', 'reject-all', 'custom', 'gpc', 'dns', 'do-not-sell'];
    for (const method of methods) {
      store({ version: 1, timestamp: 1, categories: { necessary: true }, method });
      expect(new StorageAdapter('localStorage').load()).not.toBeNull();
    }
  });

  it('rejects a primitive stored value (string)', () => {
    localStorage.setItem(STORAGE_KEY, '"just-a-string"');
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects a null JSON value', () => {
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects do-not-sell method as valid', () => {
    store({ version: 1, timestamp: 1, categories: { necessary: true }, method: 'do-not-sell' });
    expect(new StorageAdapter('localStorage').load()).not.toBeNull();
  });

  it('rejects dns method as valid', () => {
    store({ version: 1, timestamp: 1, categories: { necessary: true }, method: 'dns' });
    expect(new StorageAdapter('localStorage').load()).not.toBeNull();
  });

  it('rejects version=0', () => {
    store({ version: 0, timestamp: 1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects negative version', () => {
    store({ version: -1, timestamp: 1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects NaN version', () => {
    store({ version: NaN, timestamp: 1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects Infinity version', () => {
    store({ version: Infinity, timestamp: 1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects negative timestamp', () => {
    store({ version: 1, timestamp: -1, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects timestamp far in the future (> 1 day)', () => {
    const farFuture = Date.now() + 2 * 86_400_000; // 2 days ahead
    store({ version: 1, timestamp: farFuture, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('accepts timestamp slightly in the future (< 1 day)', () => {
    const slightlyAhead = Date.now() + 3_600_000; // 1 hour ahead
    store({ version: 1, timestamp: slightlyAhead, categories: { necessary: true }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────
  // Prototype pollution protection
  // (Note: JSON.stringify strips __proto__, so we store raw JSON strings)
  // ─────────────────────────────────────────────────────────
  it('rejects categories with __proto__ key (prototype pollution)', () => {
    // Store raw JSON since JSON.stringify strips __proto__
    localStorage.setItem(STORAGE_KEY, '{"version":1,"timestamp":1,"categories":{"__proto__":true,"necessary":true},"method":"accept-all"}');
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects categories with constructor key (prototype pollution)', () => {
    localStorage.setItem(STORAGE_KEY, '{"version":1,"timestamp":1,"categories":{"constructor":true,"necessary":true},"method":"accept-all"}');
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('rejects categories with prototype key (prototype pollution)', () => {
    localStorage.setItem(STORAGE_KEY, '{"version":1,"timestamp":1,"categories":{"prototype":true,"necessary":true},"method":"accept-all"}');
    expect(new StorageAdapter('localStorage').load()).toBeNull();
  });

  it('accepts categories with normal keys', () => {
    store({ version: 1, timestamp: 1, categories: { necessary: true, analytics: false, marketing: false }, method: 'accept-all' });
    expect(new StorageAdapter('localStorage').load()).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// didPersist()
// ─────────────────────────────────────────────────────────
describe('StorageAdapter — didPersist()', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it('returns false before any save', () => {
    const adapter = new StorageAdapter('localStorage');
    expect(adapter.didPersist()).toBe(false);
  });

  it('returns true after saving in localStorage mode', () => {
    const adapter = new StorageAdapter('localStorage');
    adapter.save(validRecord);
    expect(adapter.didPersist()).toBe(true);
  });

  it('returns true after saving in cookie mode', () => {
    const adapter = new StorageAdapter('cookie');
    adapter.save(validRecord);
    expect(adapter.didPersist()).toBe(true);
  });

  it('returns false after save + clear in localStorage mode', () => {
    const adapter = new StorageAdapter('localStorage');
    adapter.save(validRecord);
    adapter.clear();
    expect(adapter.didPersist()).toBe(false);
  });

  it('returns false after save + clear in cookie mode', () => {
    const adapter = new StorageAdapter('cookie');
    adapter.save(validRecord);
    adapter.clear();
    expect(adapter.didPersist()).toBe(false);
  });

  it('returns false when localStorage throws', () => {
    const adapter = new StorageAdapter('localStorage');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(adapter.didPersist()).toBe(false);
    getItemSpy.mockRestore();
  });
});
