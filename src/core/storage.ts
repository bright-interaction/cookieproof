import type { ConsentRecord } from './types.js';
import { STORAGE_KEY, COOKIE_NAME, DEFAULT_EXPIRY_DAYS } from './constants.js';

export { STORAGE_KEY };

/** Keys that could trigger prototype pollution when used as object keys */
const POISONED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type StorageMethod = 'localStorage' | 'cookie';

export class StorageAdapter {
  private method: StorageMethod;
  private cookieName: string;
  private key: string;
  private expiryDays: number;
  private cookieDomain?: string;

  constructor(method: StorageMethod = 'localStorage', cookieName?: string, expiryDays?: number, cookieDomain?: string) {
    this.method = method;
    this.cookieName = StorageAdapter.validateCookieName(cookieName ?? COOKIE_NAME);
    this.key = StorageAdapter.validateCookieName(cookieName ?? STORAGE_KEY);
    const rawExpiry = expiryDays ?? DEFAULT_EXPIRY_DAYS;
    this.expiryDays = (Number.isFinite(rawExpiry) && rawExpiry > 0) ? rawExpiry : DEFAULT_EXPIRY_DAYS;
    this.cookieDomain = StorageAdapter.validateCookieDomain(cookieDomain);
  }

  private static validateCookieName(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.warn('[cookieproof] Invalid cookieName, using default');
      return STORAGE_KEY;
    }
    return name;
  }

  private static validateCookieDomain(domain: string | undefined): string | undefined {
    if (!domain) return undefined;
    if (!/^\.?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(domain)) {
      console.warn('[cookieproof] Invalid cookieDomain, ignoring');
      return undefined;
    }
    return domain;
  }

  /** Returns the resolved storage key (validated/sanitized) */
  getKey(): string {
    return this.key;
  }

  load(): ConsentRecord | null {
    if (typeof window === 'undefined') return null;
    try {
      let raw: string | null = null;

      if (this.method === 'localStorage') {
        raw = localStorage.getItem(this.key);
        // Fallback: if localStorage has no value, try reading from cookie
        // (save() falls back to cookie when localStorage fails, so load must too)
        if (!raw) {
          raw = this.getCookie();
        }
      } else {
        raw = this.getCookie();
      }

      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!this.isValidRecord(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save(record: ConsentRecord): void {
    if (typeof window === 'undefined') return;
    const data = JSON.stringify(record);
    if (this.method === 'localStorage') {
      try {
        localStorage.setItem(this.key, data);
      } catch {
        // Fallback: try cookie if localStorage fails (e.g. QuotaExceededError in private browsing)
        try {
          this.setCookie(data);
        } catch {
          // Both storage mechanisms failed – consent is kept in memory only
        }
      }
    } else {
      try {
        this.setCookie(data);
      } catch {
        // Cookie write failed (cookies fully disabled) – consent is kept in memory only
      }
    }
  }

  clear(): void {
    if (typeof window === 'undefined') return;
    // Always clear both to prevent stale fallback data
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
    this.deleteCookie();
  }

  /** Returns true if the most recent save() actually wrote to persistent storage */
  didPersist(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      if (this.method === 'localStorage') {
        return localStorage.getItem(this.key) !== null;
      }
      return this.getCookie() !== null;
    } catch {
      return false;
    }
  }

  private isValidRecord(obj: unknown): obj is ConsentRecord {
    if (!obj || typeof obj !== 'object') return false;
    const r = obj as Record<string, unknown>;
    return (
      typeof r.version === 'number' &&
      Number.isFinite(r.version) &&
      (r.version as number) > 0 &&
      typeof r.timestamp === 'number' &&
      Number.isFinite(r.timestamp) &&
      (r.timestamp as number) >= 0 &&
      // Reject timestamps more than 1 day in the future (clock-skew tolerance)
      (r.timestamp as number) <= Date.now() + 86_400_000 &&
      typeof r.categories === 'object' &&
      r.categories !== null &&
      !Array.isArray(r.categories) &&
      Object.keys(r.categories as Record<string, unknown>).every(k => !POISONED_KEYS.has(k)) &&
      Object.values(r.categories as Record<string, unknown>).every(v => typeof v === 'boolean') &&
      typeof r.method === 'string' &&
      ['accept-all', 'reject-all', 'custom', 'gpc', 'dns', 'do-not-sell'].includes(r.method)
    );
  }

  private getCookie(): string | null {
    const prefix = `${this.cookieName}=`;
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const trimmed = c.trim();
      if (trimmed.startsWith(prefix)) {
        try {
          return decodeURIComponent(trimmed.substring(prefix.length));
        } catch {
          // Malformed cookie value (e.g. bare % characters) — treat as absent
          return null;
        }
      }
    }
    return null;
  }

  private static isSecure(): boolean {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
  }

  private setCookie(value: string): void {
    const expires = new Date(Date.now() + this.expiryDays * 864e5).toUTCString();
    const domain = this.cookieDomain ? `; domain=${this.cookieDomain}` : '';
    const secure = StorageAdapter.isSecure() ? '; Secure' : '';
    document.cookie = `${this.cookieName}=${encodeURIComponent(value)}; expires=${expires}; path=/${domain}; SameSite=Lax${secure}`;
  }

  private deleteCookie(): void {
    const domain = this.cookieDomain ? `; domain=${this.cookieDomain}` : '';
    const secure = StorageAdapter.isSecure() ? '; Secure' : '';
    document.cookie = `${this.cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}; SameSite=Lax${secure}`;
  }

  /** Clear specific cookies by name or pattern (for consent revocation) */
  static clearCookies(patterns: string[]): void {
    if (typeof window === 'undefined') return;
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const name = c.split('=')[0].trim();
      for (const pattern of patterns) {
        // Skip patterns with characters that could cause cookie injection
        if (/[;\r\n\\]/.test(pattern)) continue;
        if (pattern.endsWith('*')) {
          const prefix = pattern.slice(0, -1);
          if (prefix.length < 2) continue; // Reject overly broad patterns like "*" or "x*"
          if (name.startsWith(prefix)) {
            StorageAdapter.expireCookie(name);
          }
        } else if (name === pattern) {
          StorageAdapter.expireCookie(name);
        }
      }
    }
  }

  private static expireCookie(name: string): void {
    const hostname = location.hostname;
    const secure = StorageAdapter.isSecure() ? '; Secure' : '';
    // Walk up the domain hierarchy: for www.sub.example.com, also try
    // .sub.example.com and .example.com (where GA/analytics cookies often live)
    const parts = hostname.split('.');
    const domains = [hostname, `.${hostname}`];
    for (let i = 1; i < parts.length - 1; i++) {
      domains.push('.' + parts.slice(i).join('.'));
    }
    const paths = ['/', ''];
    for (const domain of domains) {
      for (const path of paths) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; domain=${domain}; SameSite=Lax${secure}`;
      }
    }
    // Also try without domain
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax${secure}`;
  }
}
