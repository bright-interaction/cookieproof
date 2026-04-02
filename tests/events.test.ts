import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../src/core/events.js';
import type { ConsentEventDetail } from '../src/core/types.js';

function makeDetail(method: ConsentEventDetail['consent']['method'] = 'accept-all'): ConsentEventDetail {
  return {
    consent: {
      version: 1,
      timestamp: 1700000000000,
      categories: { necessary: true, analytics: true },
      method,
    },
  };
}

describe('EventBus', () => {
  let target: EventTarget;
  let bus: EventBus;

  beforeEach(() => {
    target = new EventTarget();
    bus = new EventBus(target);
  });

  // ─── on / emit basics ────────────────────────────────────

  it('calls an internal listener when the matching event is emitted', () => {
    const listener = vi.fn();
    const detail = makeDetail();

    bus.on('consent:update', listener);
    bus.emit('consent:update', detail);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(detail);
  });

  it('does not call a listener registered for a different event', () => {
    const listener = vi.fn();
    bus.on('consent:accept-all', listener);
    bus.emit('consent:reject-all', makeDetail('reject-all'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('passes the detail object unchanged to the listener', () => {
    const detail = makeDetail();
    detail.changed = ['analytics', 'marketing'];

    const listener = vi.fn();
    bus.on('consent:update', listener);
    bus.emit('consent:update', detail);

    expect(listener.mock.calls[0][0]).toBe(detail);
  });

  // ─── multiple listeners ───────────────────────────────────

  it('calls all listeners registered for the same event', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();

    bus.on('consent:init', a);
    bus.on('consent:init', b);
    bus.on('consent:init', c);
    bus.emit('consent:init', makeDetail());

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('handles listeners on different event types independently', () => {
    const updateListener = vi.fn();
    const initListener = vi.fn();

    bus.on('consent:update', updateListener);
    bus.on('consent:init', initListener);

    bus.emit('consent:update', makeDetail());

    expect(updateListener).toHaveBeenCalledTimes(1);
    expect(initListener).not.toHaveBeenCalled();
  });

  // ─── unsubscribe ──────────────────────────────────────────

  it('on() returns a function that unsubscribes the listener', () => {
    const listener = vi.fn();
    const unsub = bus.on('consent:init', listener);

    bus.emit('consent:init', makeDetail());
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit('consent:init', makeDetail());
    expect(listener).toHaveBeenCalledTimes(1); // still 1 — not called again
  });

  it('unsubscribing one listener does not affect other listeners on the same event', () => {
    const a = vi.fn();
    const b = vi.fn();

    const unsubA = bus.on('consent:update', a);
    bus.on('consent:update', b);

    unsubA();
    bus.emit('consent:update', makeDetail());

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('calling the unsubscribe function twice is safe', () => {
    const listener = vi.fn();
    const unsub = bus.on('consent:update', listener);

    unsub();
    expect(() => unsub()).not.toThrow();
  });

  // ─── destroy ─────────────────────────────────────────────

  it('destroy() removes all internal listeners', () => {
    const a = vi.fn();
    const b = vi.fn();

    bus.on('consent:update', a);
    bus.on('consent:init', b);

    bus.destroy();

    bus.emit('consent:update', makeDetail());
    bus.emit('consent:init', makeDetail());

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('emitting after destroy does not throw', () => {
    bus.on('consent:update', vi.fn());
    bus.destroy();
    expect(() => bus.emit('consent:update', makeDetail())).not.toThrow();
  });

  // ─── DOM CustomEvent dispatch ─────────────────────────────

  it('dispatches a CustomEvent on the target with the correct type', () => {
    const domListener = vi.fn();
    target.addEventListener('consent:accept-all', domListener);

    bus.emit('consent:accept-all', makeDetail());

    expect(domListener).toHaveBeenCalledTimes(1);
    const event = domListener.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('consent:accept-all');
  });

  it('CustomEvent carries the detail payload', () => {
    const detail = makeDetail('reject-all');
    const domListener = vi.fn();

    target.addEventListener('consent:reject-all', domListener);
    bus.emit('consent:reject-all', detail);

    const event = domListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual(detail);
  });

  it('CustomEvent has bubbles=true and composed=true', () => {
    const domListener = vi.fn();
    target.addEventListener('consent:gpc', domListener);

    bus.emit('consent:gpc', makeDetail('gpc'));

    const event = domListener.mock.calls[0][0] as CustomEvent;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // ─── dynamic category events ──────────────────────────────

  it('supports dynamic consent:category:<id> event types', () => {
    const listener = vi.fn();
    bus.on('consent:category:analytics', listener);
    bus.emit('consent:category:analytics', makeDetail());

    expect(listener).toHaveBeenCalledTimes(1);
  });

  // ─── error isolation ──────────────────────────────────────

  it('a throwing listener does not prevent subsequent listeners from running', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const before = vi.fn();
    const thrower = vi.fn(() => { throw new Error('boom'); });
    const after = vi.fn();

    bus.on('consent:update', before);
    bus.on('consent:update', thrower);
    bus.on('consent:update', after);

    bus.emit('consent:update', makeDetail());

    expect(before).toHaveBeenCalledTimes(1);
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('listener that unsubscribes itself during emit does not break other listeners', () => {
    const results: string[] = [];

    let unsub: () => void;
    const selfUnsubscriber = vi.fn(() => {
      results.push('self');
      unsub(); // unsubscribe self during iteration
    });
    unsub = bus.on('consent:update', selfUnsubscriber);

    const after = vi.fn(() => results.push('after'));
    bus.on('consent:update', after);

    bus.emit('consent:update', makeDetail());

    expect(selfUnsubscriber).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['self', 'after']);
  });

  it('listener added during emit is not called in the same emit cycle', () => {
    const lateListener = vi.fn();

    bus.on('consent:update', () => {
      // Add a new listener during emit
      bus.on('consent:update', lateListener);
    });

    bus.emit('consent:update', makeDetail());

    // The late listener should NOT be called during this emit
    expect(lateListener).not.toHaveBeenCalled();

    // But it SHOULD be called on the next emit
    bus.emit('consent:update', makeDetail());
    expect(lateListener).toHaveBeenCalledTimes(1);
  });

  it('error in listener is logged to console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.on('consent:init', () => { throw new Error('test error'); });
    bus.emit('consent:init', makeDetail());

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[cookieproof]'),
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });
});
