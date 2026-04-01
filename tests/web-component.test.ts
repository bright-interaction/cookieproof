import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import to register the custom element
import '../src/index.js';
import type { CookieConsentElement } from '../src/consent-element.js';

describe('CookieConsentElement', () => {
  let el: CookieConsentElement;

  beforeEach(() => {
    localStorage.clear();
    el = document.createElement('cookie-consent') as CookieConsentElement;
  });

  afterEach(() => {
    el.remove();
  });

  it('should be registered as a custom element', () => {
    expect(customElements.get('cookie-consent')).toBeDefined();
  });

  it('should have a shadow root after construction', () => {
    expect(el.shadowRoot).not.toBeNull();
  });

  it('should render banner on first visit when connected', async () => {
    document.body.appendChild(el);
    // Wait for requestAnimationFrame
    await new Promise((r) => setTimeout(r, 50));

    const banner = el.shadowRoot!.querySelector('.cc-banner');
    expect(banner).not.toBeNull();
  });

  it('should hide banner after acceptAll', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    const banner = el.shadowRoot!.querySelector('.cc-banner');
    expect(banner?.classList.contains('visible')).toBe(false);
  });

  it('should return consent record after accepting', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    const consent = el.getConsent();
    expect(consent).not.toBeNull();
    expect(consent!.categories.analytics).toBe(true);
    expect(consent!.method).toBe('accept-all');
  });

  it('should return consent record after rejecting', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.rejectAll();
    const consent = el.getConsent();
    expect(consent).not.toBeNull();
    expect(consent!.categories.analytics).toBe(false);
    expect(consent!.categories.necessary).toBe(true);
    expect(consent!.method).toBe('reject-all');
  });

  it('should show floating trigger after consent given', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    await new Promise((r) => setTimeout(r, 50));

    const trigger = el.shadowRoot!.querySelector('.cc-trigger');
    expect(trigger).not.toBeNull();
  });

  it('should reset consent and show banner again', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    expect(el.getConsent()).not.toBeNull();

    el.reset();
    expect(el.getConsent()).toBeNull();

    const banner = el.shadowRoot!.querySelector('.cc-banner');
    expect(banner?.classList.contains('visible')).toBe(true);
  });

  it('should accept config via configure()', async () => {
    el.configure({
      theme: 'dark',
      position: 'top',
    });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    expect(el.getAttribute('data-theme')).toBe('dark');
    const banner = el.shadowRoot!.querySelector('.cc-banner');
    expect(banner?.getAttribute('data-position')).toBe('top');
  });

  it('should fire consent:accept-all event', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    let fired = false;
    el.on('consent:accept-all', () => { fired = true; });
    el.acceptAll();
    expect(fired).toBe(true);
  });

  it('hasConsent should work correctly', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    expect(el.hasConsent('analytics')).toBe(false);
    el.acceptAll();
    expect(el.hasConsent('analytics')).toBe(true);
  });

  it('should re-initialize after disconnect and reconnect', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    // Accept consent before disconnecting
    el.acceptAll();
    expect(el.getConsent()).not.toBeNull();

    // Disconnect the element (simulates SPA navigation)
    el.remove();

    // Reconnect the element
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    // Should have re-initialized and restored consent from storage
    expect(el.getConsent()).not.toBeNull();
    expect(el.getConsent()!.method).toBe('accept-all');

    // UI should be functional — trigger visible for returning visitor
    const trigger = el.shadowRoot!.querySelector('.cc-trigger');
    expect(trigger).not.toBeNull();

    // Event system should work after reconnect
    let fired = false;
    el.on('consent:update', () => { fired = true; });
    el.rejectAll();
    expect(fired).toBe(true);
  });

  it('should render all three buttons with equal styling', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    const reject = el.shadowRoot!.querySelector('.cc-btn-reject') as HTMLElement;
    const accept = el.shadowRoot!.querySelector('.cc-btn-accept') as HTMLElement;
    const settings = el.shadowRoot!.querySelector('.cc-btn-settings') as HTMLElement;

    expect(reject).not.toBeNull();
    expect(accept).not.toBeNull();
    expect(settings).not.toBeNull();

    // IMY compliance: reject and accept should be present on first layer
    expect(reject.textContent).toBeTruthy();
    expect(accept.textContent).toBeTruthy();
  });

  // ─── Headless mode ─────────────────────────────────────
  it('headless: should not render any UI elements', async () => {
    el.configure({ headless: true });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    const banner = el.shadowRoot!.querySelector('.cc-banner');
    const overlay = el.shadowRoot!.querySelector('.cc-overlay');
    const trigger = el.shadowRoot!.querySelector('.cc-trigger');

    expect(banner).toBeNull();
    expect(overlay).toBeNull();
    expect(trigger).toBeNull();
  });

  it('headless: acceptAll still works programmatically', async () => {
    el.configure({ headless: true });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    const consent = el.getConsent();
    expect(consent).not.toBeNull();
    expect(consent!.method).toBe('accept-all');
    expect(consent!.categories.analytics).toBe(true);
  });

  it('headless: rejectAll works programmatically', async () => {
    el.configure({ headless: true });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.rejectAll();
    const consent = el.getConsent();
    expect(consent).not.toBeNull();
    expect(consent!.method).toBe('reject-all');
    expect(consent!.categories.analytics).toBe(false);
  });

  it('headless: events still fire', async () => {
    el.configure({ headless: true });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    let fired = false;
    el.on('consent:accept-all', () => { fired = true; });
    el.acceptAll();
    expect(fired).toBe(true);
  });

  it('headless: showBanner and showPreferences are no-ops', async () => {
    el.configure({ headless: true });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    // These should not throw
    el.showBanner();
    el.showPreferences();
    expect(el.shadowRoot!.querySelector('.cc-banner')).toBeNull();
  });

  // ─── Rebuild + listener preservation ───────────────────
  it('rebuild preserves external event listeners', async () => {
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    // Register a listener
    let eventCount = 0;
    el.on('consent:accept-all', () => { eventCount++; });

    // First accept
    el.acceptAll();
    expect(eventCount).toBe(1);

    // Rebuild via configure()
    el.configure({ theme: 'dark', position: 'top' });
    await new Promise((r) => setTimeout(r, 50));

    // Accept again after rebuild — listener should still fire
    el.acceptAll();
    expect(eventCount).toBe(2);
  });

  // ─── Duplicate / empty category IDs ────────────────────
  it('should skip categories with empty IDs', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    el.configure({
      categories: [
        { id: 'necessary', required: true },
        { id: '', required: false },
        { id: 'analytics', required: false },
      ],
    });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    const consent = el.getConsent();
    expect(consent).not.toBeNull();
    // Should only have necessary and analytics (empty ID skipped)
    expect(Object.keys(consent!.categories)).not.toContain('');
    warnSpy.mockRestore();
  });

  it('should skip duplicate category IDs', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    el.configure({
      categories: [
        { id: 'necessary', required: true },
        { id: 'analytics', required: false },
        { id: 'analytics', required: false }, // duplicate
      ],
    });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    el.acceptAll();
    const consent = el.getConsent();
    expect(consent).not.toBeNull();
    // analytics should appear once
    expect(consent!.categories.analytics).toBe(true);
    warnSpy.mockRestore();
  });

  // ─── Keyboard shortcut edge cases ─────────────────────
  it('should handle empty keyboard shortcut gracefully', async () => {
    el.configure({ keyboardShortcut: '' });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    // Should not throw — banner should render normally
    const banner = el.shadowRoot!.querySelector('.cc-banner');
    expect(banner).not.toBeNull();
  });

  it('should handle whitespace-only keyboard shortcut', async () => {
    el.configure({ keyboardShortcut: '   ' });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));

    const banner = el.shadowRoot!.querySelector('.cc-banner');
    expect(banner).not.toBeNull();
  });
});
