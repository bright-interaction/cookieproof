import type { ConsentEventType, ConsentEventDetail } from './types.js';

type Listener = (detail: ConsentEventDetail) => void;

export class EventBus {
  private target: EventTarget;
  private listeners = new Map<string, Set<Listener>>();

  constructor(target: EventTarget) {
    this.target = target;
  }

  emit(type: ConsentEventType, detail: ConsentEventDetail): void {
    this.target.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true })
    );

    // Also notify internal subscribers (snapshot to avoid re-entrancy issues
    // if a listener unsubscribes itself or adds new listeners during emit)
    const set = this.listeners.get(type);
    if (set) {
      for (const fn of Array.from(set)) {
        try {
          fn(detail);
        } catch (err) {
          console.error(`[cookieproof] Listener error on "${type}":`, err);
        }
      }
    }
  }

  on(type: ConsentEventType, listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(type);
    };
  }

  /** Export a snapshot of all current listeners (for rebuild preservation) */
  exportListeners(): Map<string, Set<Listener>> {
    const snapshot = new Map<string, Set<Listener>>();
    for (const [type, set] of this.listeners) {
      snapshot.set(type, new Set(set));
    }
    return snapshot;
  }

  /** Import previously exported listeners, merging with any existing */
  importListeners(snapshot: Map<string, Set<Listener>>): void {
    for (const [type, set] of snapshot) {
      let existing = this.listeners.get(type);
      if (!existing) {
        existing = new Set();
        this.listeners.set(type, existing);
      }
      for (const fn of set) {
        existing.add(fn);
      }
    }
  }

  destroy(): void {
    this.listeners.clear();
  }
}
