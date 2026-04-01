import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptGate } from '../src/core/script-gate.js';
import { DEFAULT_CATEGORIES } from '../src/core/constants.js';

describe('ScriptGate', () => {
  beforeEach(() => {
    // Clean up any test elements
    document.body.innerHTML = '';
  });

  it('should activate scripts for consented categories', () => {
    document.body.innerHTML = `
      <script type="text/plain" data-consent="analytics" data-test="analytics-script">
        window.__testAnalytics = true;
      </script>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: true, marketing: false, preferences: false });

    // The original script should be replaced
    const original = document.querySelector('script[data-test="analytics-script"][type="text/plain"]');
    expect(original).toBeNull();

    // A new script with type="text/javascript" should exist
    const activated = document.querySelector('script[data-test="analytics-script"]');
    expect(activated).not.toBeNull();
    expect(activated?.getAttribute('type')).toBe('text/javascript');
  });

  it('should not activate scripts for denied categories', () => {
    document.body.innerHTML = `
      <script type="text/plain" data-consent="marketing" data-test="marketing-script">
        window.__testMarketing = true;
      </script>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });

    const blocked = document.querySelector('script[data-test="marketing-script"][type="text/plain"]');
    expect(blocked).not.toBeNull(); // Still blocked
  });

  it('should activate iframes by swapping data-src to src', () => {
    document.body.innerHTML = `
      <iframe data-consent="marketing" data-src="https://www.youtube.com/embed/test" data-test="yt-iframe" style="display:none;"></iframe>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: true, preferences: false });

    const iframe = document.querySelector('[data-test="yt-iframe"]') as HTMLIFrameElement;
    expect(iframe.src).toContain('youtube.com/embed/test');
    expect(iframe.hasAttribute('data-src')).toBe(false);
  });

  it('should activate images (tracking pixels)', () => {
    document.body.innerHTML = `
      <img data-consent="marketing" data-src="https://tracking.example.com/pixel.gif" data-test="pixel" />
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: true, preferences: false });

    const img = document.querySelector('[data-test="pixel"]') as HTMLImageElement;
    expect(img.src).toContain('tracking.example.com/pixel.gif');
  });

  it('should activate newly consented categories on updateConsent', () => {
    document.body.innerHTML = `
      <script type="text/plain" data-consent="analytics" data-test="deferred">
        window.__deferred = true;
      </script>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });

    // Still blocked
    expect(document.querySelector('script[data-test="deferred"][type="text/plain"]')).not.toBeNull();

    // Now grant analytics
    gate.updateConsent({ necessary: true, analytics: true, marketing: false, preferences: false });

    // Should be activated
    const activated = document.querySelector('script[data-test="deferred"]');
    expect(activated?.getAttribute('type')).toBe('text/javascript');
  });

  it('should clean up on destroy', () => {
    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });
    // Should not throw
    gate.destroy();
  });

  it('should preserve inline script textContent after activation', () => {
    const inlineCode = 'console.log("hello from inline");';
    document.body.innerHTML = `
      <script type="text/plain" data-consent="analytics" data-test="inline-preserve">${inlineCode}</script>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: true, marketing: false, preferences: false });

    const activated = document.querySelector('script[data-test="inline-preserve"]') as HTMLScriptElement;
    expect(activated).not.toBeNull();
    expect(activated.type).toBe('text/javascript');
    expect(activated.textContent).toBe(inlineCode);
    gate.destroy();
  });

  // ─────────────────────────────────────────────────────────
  // Deactivation on consent revocation
  // ─────────────────────────────────────────────────────────

  it('should deactivate iframes by moving src back to data-src on revocation', () => {
    document.body.innerHTML = `
      <iframe data-consent="marketing" data-src="https://embed.example.com/video" data-test="revoke-iframe" style="display:none;"></iframe>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: true, preferences: false });

    // Iframe should be activated
    const iframe = document.querySelector('[data-test="revoke-iframe"]') as HTMLIFrameElement;
    expect(iframe.src).toContain('embed.example.com/video');
    expect(iframe.hasAttribute('data-src')).toBe(false);

    // Now revoke marketing
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });

    // Iframe src should be moved back to data-src, src set to about:blank
    expect(iframe.getAttribute('data-src')).toContain('embed.example.com/video');
    expect(iframe.src).toContain('about:blank');
  });

  it('should deactivate images by moving src back to data-src on revocation', () => {
    document.body.innerHTML = `
      <img data-consent="marketing" data-src="https://tracking.example.com/pixel.gif" data-test="revoke-img" />
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: true, preferences: false });

    const img = document.querySelector('[data-test="revoke-img"]') as HTMLImageElement;
    expect(img.src).toContain('tracking.example.com/pixel.gif');

    // Revoke marketing
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });

    expect(img.getAttribute('data-src')).toContain('tracking.example.com/pixel.gif');
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('should deactivate links by moving href back to data-href on revocation', () => {
    document.body.innerHTML = `
      <link data-consent="analytics" data-href="https://cdn.example.com/analytics.css" rel="stylesheet" data-test="revoke-link" />
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: true, marketing: false, preferences: false });

    const link = document.querySelector('[data-test="revoke-link"]') as HTMLLinkElement;
    expect(link.href).toContain('cdn.example.com/analytics.css');
    expect(link.hasAttribute('data-href')).toBe(false);

    // Revoke analytics
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });

    expect(link.getAttribute('data-href')).toContain('cdn.example.com/analytics.css');
    expect(link.hasAttribute('href')).toBe(false);
  });

  it('should not double-deactivate already-deactivated elements', () => {
    document.body.innerHTML = `
      <iframe data-consent="marketing" data-src="https://embed.example.com/video" data-test="double-deactivate"></iframe>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    // Never activated — marketing is false
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });

    const iframe = document.querySelector('[data-test="double-deactivate"]') as HTMLIFrameElement;
    // data-src should still be present (never activated)
    expect(iframe.hasAttribute('data-src')).toBe(true);

    // updateConsent with marketing still false — should be a no-op
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });
    expect(iframe.getAttribute('data-src')).toContain('embed.example.com/video');
  });

  it('should re-activate elements after revocation then re-consent', () => {
    document.body.innerHTML = `
      <iframe data-consent="marketing" data-src="https://embed.example.com/video" data-test="reactivate"></iframe>
    `;

    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: false, marketing: true, preferences: false });

    const iframe = document.querySelector('[data-test="reactivate"]') as HTMLIFrameElement;
    expect(iframe.src).toContain('embed.example.com/video');

    // Revoke
    gate.updateConsent({ necessary: true, analytics: false, marketing: false, preferences: false });
    expect(iframe.src).toContain('about:blank');

    // Re-consent
    gate.updateConsent({ necessary: true, analytics: false, marketing: true, preferences: false });
    expect(iframe.src).toContain('embed.example.com/video');
    expect(iframe.hasAttribute('data-src')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────
  // startBlocking() — observer before consent decision
  // ─────────────────────────────────────────────────────────

  it('startBlocking() prevents double-starting the observer', () => {
    const gate = new ScriptGate(DEFAULT_CATEGORIES);
    gate.startBlocking();
    // Calling startBlocking again should not throw or create a second observer
    gate.startBlocking();
    gate.updateConsent({ necessary: true, analytics: true, marketing: false, preferences: false });
    gate.destroy();
  });
});
