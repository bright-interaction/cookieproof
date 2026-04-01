import type {
  ConsentRecord,
  CookieConsentConfig,
  CategoryConfig,
  ConsentEventDetail,
} from './types.js';
import { DEFAULT_CATEGORIES } from './constants.js';
import { StorageAdapter } from './storage.js';
import { EventBus } from './events.js';

export class ConsentManager {
  private storage: StorageAdapter;
  private events: EventBus;
  private categories: CategoryConfig[];
  private revision: number;
  private record: ConsentRecord | null = null;
  private proofEndpoint?: string;
  private respectGPC: boolean;

  constructor(config: CookieConsentConfig, events: EventBus) {
    this.storage = new StorageAdapter(
      config.storage ?? 'localStorage',
      config.cookieName,
      config.cookieExpiry,
      config.cookieDomain
    );
    this.events = events;
    this.categories = config.categories?.length ? config.categories : DEFAULT_CATEGORIES;
    const rawRevision = config.revision ?? 1;
    this.revision = (Number.isInteger(rawRevision) && rawRevision > 0) ? rawRevision : 1;
    if (config.proofEndpoint && /^https:\/\//i.test(config.proofEndpoint)) {
      this.proofEndpoint = config.proofEndpoint;
    } else if (config.proofEndpoint) {
      console.warn('[cookieproof] proofEndpoint must use HTTPS — proof delivery disabled.');
    }
    this.respectGPC = config.respectGPC !== false; // default true
  }

  init(): { needsBanner: boolean; gpcApplied: boolean } {
    this.record = this.storage.load();

    if (this.record && this.record.version !== this.revision) {
      // Policy changed — re-ask
      this.record = null;
      this.storage.clear();
      try { localStorage.removeItem('ce_signals'); } catch { /* ignore */ }
    }

    // GPC: auto-reject non-essential if no prior consent exists
    if (!this.record && this.respectGPC && this.isGPCEnabled()) {
      this.record = this.buildGPCRecord();
      this.storage.save(this.record);
      this.sendProof(this.record);

      const snapshot: ConsentRecord = { ...this.record, categories: { ...this.record.categories } };
      const detail: ConsentEventDetail = { consent: snapshot };
      this.events.emit('consent:gpc', detail);
      this.events.emit('consent:init', detail);

      return { needsBanner: false, gpcApplied: true };
    }

    const initRecord = this.record ?? this.buildDefaultRecord();
    const detail: ConsentEventDetail = {
      consent: { ...initRecord, categories: { ...initRecord.categories } },
    };
    this.events.emit('consent:init', detail);

    return { needsBanner: this.record === null, gpcApplied: false };
  }

  /** Reload consent from storage (cross-tab sync). Does NOT re-emit consent:init or re-trigger GPC. */
  reload(): ConsentRecord | null {
    this.record = this.storage.load();
    if (this.record && this.record.version !== this.revision) {
      this.record = null;
      this.storage.clear();
      try { localStorage.removeItem('ce_signals'); } catch { /* ignore */ }
    }
    return this.record ? { ...this.record, categories: { ...this.record.categories } } : null;
  }

  private isGPCEnabled(): boolean {
    try {
      return (navigator as any).globalPrivacyControl === true;
    } catch {
      return false;
    }
  }

  private buildGPCRecord(): ConsentRecord {
    const categories: Record<string, boolean> = {};
    for (const cat of this.categories) {
      categories[cat.id] = cat.required === true;
    }
    return {
      version: this.revision,
      timestamp: Date.now(),
      categories,
      method: 'gpc',
    };
  }

  /** Returns the resolved (validated) storage key */
  getStorageKey(): string {
    return this.storage.getKey();
  }

  getCategories(): CategoryConfig[] {
    return this.categories.map((c) => ({ ...c }));
  }

  getConsent(): ConsentRecord | null {
    return this.record
      ? { ...this.record, categories: { ...this.record.categories } }
      : null;
  }

  hasConsent(categoryId: string): boolean {
    const cat = this.categories.find((c) => c.id === categoryId);
    if (cat?.required) return true;
    if (!this.record) return false;
    return this.record.categories[categoryId] === true;
  }

  acceptAll(): ConsentRecord {
    const categories: Record<string, boolean> = {};
    for (const cat of this.categories) {
      categories[cat.id] = true;
    }
    return this.saveRecord(categories, 'accept-all');
  }

  rejectAll(): ConsentRecord {
    const categories: Record<string, boolean> = {};
    for (const cat of this.categories) {
      categories[cat.id] = cat.required === true;
      // Clear cookies for all non-required categories (handles pre-existing cookies)
      if (!cat.required) {
        const cookies = cat.services?.flatMap((s) => s.cookies ?? []) ?? [];
        if (cookies.length) StorageAdapter.clearCookies(cookies);
      }
    }
    return this.saveRecord(categories, 'reject-all');
  }

  doNotSell(): ConsentRecord {
    const categories: Record<string, boolean> = {};
    for (const cat of this.categories) {
      if (cat.required) {
        categories[cat.id] = true;
      } else if (cat.id === 'marketing' || cat.id === 'advertising') {
        categories[cat.id] = false;
        // Clear cookies for rejected marketing/advertising categories
        const cookies = cat.services?.flatMap((s) => s.cookies ?? []) ?? [];
        if (cookies.length) StorageAdapter.clearCookies(cookies);
      } else {
        // Keep current state for non-marketing categories; default to false (not cat.enabled)
        // to avoid auto-granting consent without explicit user action
        categories[cat.id] = this.record?.categories[cat.id] ?? false;
      }
    }
    return this.saveRecord(categories, 'do-not-sell');
  }

  setCategories(selected: Record<string, boolean>): ConsentRecord {
    const categories: Record<string, boolean> = {};
    for (const cat of this.categories) {
      if (cat.required) {
        categories[cat.id] = true;
      } else {
        categories[cat.id] = selected[cat.id] === true;
        // Clear cookies when revoking consent for a category
        if (!categories[cat.id] && this.record?.categories[cat.id]) {
          const cookies = cat.services?.flatMap((s) => s.cookies ?? []) ?? [];
          if (cookies.length) StorageAdapter.clearCookies(cookies);
        }
      }
    }
    return this.saveRecord(categories, 'custom');
  }

  acceptCategory(id: string): void {
    if (!this.record) return;
    if (!this.categories.some((c) => c.id === id)) return; // Unknown category
    const updated = { ...this.record.categories, [id]: true };
    this.saveRecord(updated, 'custom');
  }

  rejectCategory(id: string): void {
    if (!this.record) return;
    const cat = this.categories.find((c) => c.id === id);
    if (!cat) return; // Unknown category
    if (cat.required) return; // Can't reject required
    const updated = { ...this.record.categories, [id]: false };
    this.saveRecord(updated, 'custom');

    // Clear cookies for services in this category
    const cookies = cat?.services?.flatMap((s) => s.cookies ?? []) ?? [];
    if (cookies.length) StorageAdapter.clearCookies(cookies);
  }

  reset(): void {
    // Log revocation proof before clearing
    if (this.record) {
      const revocationRecord: ConsentRecord = {
        version: this.revision,
        timestamp: Date.now(),
        categories: Object.fromEntries(
          this.categories.map((c) => [c.id, c.required === true])
        ),
        method: 'reject-all',
      };
      this.sendProof(revocationRecord);
    }
    this.record = null;
    this.storage.clear();
    try { localStorage.removeItem('ce_signals'); } catch { /* ignore */ }
  }

  private saveRecord(
    categories: Record<string, boolean>,
    method: ConsentRecord['method']
  ): ConsentRecord {
    const previous = this.record?.categories ?? {};
    const changed: string[] = [];
    for (const key of Object.keys(categories)) {
      if (previous[key] !== categories[key]) changed.push(key);
    }

    this.record = {
      version: this.revision,
      timestamp: Date.now(),
      categories,
      method,
    };
    this.storage.save(this.record);
    this.sendProof(this.record);

    // Defensive copy for events and return value — prevents callback mutation
    // from corrupting internal state (this.record is the live reference)
    const snapshot: ConsentRecord = { ...this.record, categories: { ...this.record.categories } };
    const detail: ConsentEventDetail = { consent: snapshot, changed };

    if (method === 'accept-all') {
      this.events.emit('consent:accept-all', detail);
    } else if (method === 'reject-all') {
      this.events.emit('consent:reject-all', detail);
    }
    this.events.emit('consent:update', detail);

    for (const catId of changed) {
      this.events.emit(`consent:category:${catId}`, detail);
    }

    return snapshot;
  }

  private static readonly PROOF_QUEUE_KEY = 'ce_proof_queue';

  private sendProof(record: ConsentRecord): void {
    if (!this.proofEndpoint) return;
    const payload = JSON.stringify({
      consent: record,
      url: location.origin + location.pathname,
      timestamp: Date.now(),
      persisted: this.storage.didPersist(),
    });

    // Flush previously queued proofs BEFORE enqueuing the new one
    // to avoid flushQueue re-sending the just-enqueued payload
    this.flushQueue();

    if (!this.trySend(payload)) {
      this.enqueueProof(payload);
    }
  }

  private trySend(payload: string): boolean {
    try {
      if (typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        return navigator.sendBeacon(this.proofEndpoint!, blob);
      }
      // fetch is fire-and-forget — we can't know if it succeeds, so return false
      // to ensure the proof is queued as a safety net. Duplicates are harmless
      // (server uses UUID, and proofs are idempotent).
      fetch(this.proofEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
      return false;
    } catch {
      return false;
    }
  }

  private enqueueProof(payload: string): void {
    try {
      const raw = localStorage.getItem(ConsentManager.PROOF_QUEUE_KEY);
      let queue: string[];
      try {
        queue = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(queue)) queue = [];
        // Validate all items are strings (guard against corrupted data)
        queue = queue.filter((item): item is string => typeof item === 'string');
      } catch {
        // Corrupted queue — reset it
        console.warn('[cookieproof] Corrupted proof queue cleared');
        queue = [];
      }
      if (queue.length >= 50) {
        console.warn('[cookieproof] Proof queue full (50 items) — oldest entry dropped');
        queue.shift();
      }
      queue.push(payload);
      localStorage.setItem(ConsentManager.PROOF_QUEUE_KEY, JSON.stringify(queue));
    } catch {
      // Storage unavailable (incognito) — accept the loss
    }
  }

  private flushQueue(): void {
    if (!this.proofEndpoint) return;
    try {
      const raw = localStorage.getItem(ConsentManager.PROOF_QUEUE_KEY);
      if (!raw) return;
      let queue: string[];
      try {
        queue = JSON.parse(raw);
        if (!Array.isArray(queue)) throw new Error('not array');
        queue = queue.filter((item): item is string => typeof item === 'string');
      } catch {
        // Corrupted queue — clear it
        localStorage.removeItem(ConsentManager.PROOF_QUEUE_KEY);
        return;
      }
      if (!queue.length) return;

      const remaining: string[] = [];
      for (const entry of queue) {
        if (!this.trySend(entry)) {
          remaining.push(entry);
        }
      }

      if (remaining.length) {
        localStorage.setItem(ConsentManager.PROOF_QUEUE_KEY, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(ConsentManager.PROOF_QUEUE_KEY);
      }
    } catch {
      // Storage unavailable — clear to prevent stuck queue
      try { localStorage.removeItem(ConsentManager.PROOF_QUEUE_KEY); } catch { /* ignore */ }
    }
  }

  private buildDefaultRecord(): ConsentRecord {
    const categories: Record<string, boolean> = {};
    for (const cat of this.categories) {
      categories[cat.id] = cat.required === true;
    }
    return {
      version: this.revision,
      timestamp: 0,
      categories,
      method: 'reject-all',
    };
  }
}
