import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTranslations } from '../src/i18n/index.js';
import { en } from '../src/i18n/en.js';
import { sv } from '../src/i18n/sv.js';
import type { TranslationStrings } from '../src/core/types.js';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function setHtmlLang(lang: string) {
  document.documentElement.lang = lang;
}

function clearHtmlLang() {
  document.documentElement.removeAttribute('lang');
}

// ─────────────────────────────────────────────────────────
// resolveTranslations — explicit language argument
// ─────────────────────────────────────────────────────────
describe('resolveTranslations() — explicit language', () => {
  it('returns English strings when language is "en"', () => {
    const t = resolveTranslations('en');
    expect(t.banner.title).toBe(en.banner.title);
    expect(t.banner.acceptAll).toBe(en.banner.acceptAll);
  });

  it('returns Swedish strings when language is "sv"', () => {
    const t = resolveTranslations('sv');
    expect(t.banner.title).toBe(sv.banner.title);
    expect(t.banner.acceptAll).toBe(sv.banner.acceptAll);
  });

  it('falls back to English when language code is unknown', () => {
    const t = resolveTranslations('xx');
    expect(t).toBe(en);
  });

  it('falls back to English when language is undefined and no HTML lang or navigator.language', () => {
    clearHtmlLang();
    // happy-dom's navigator.language defaults to 'en'; resolveTranslations will use it
    // and fall back to English either way
    const t = resolveTranslations(undefined);
    expect(t.banner.acceptAll).toBeTruthy();
  });

  it('handles locale sub-tags like "sv-SE" by stripping to base "sv"', () => {
    const t = resolveTranslations('sv-SE');
    expect(t.banner.title).toBe(sv.banner.title);
  });

  it('handles locale sub-tags like "en-GB" by stripping to base "en"', () => {
    const t = resolveTranslations('en-GB');
    expect(t.banner.title).toBe(en.banner.title);
  });

  it('handles locale sub-tags for unknown language by falling back to English', () => {
    const t = resolveTranslations('xx-XX');
    expect(t).toBe(en);
  });
});

// ─────────────────────────────────────────────────────────
// resolveTranslations — custom translations
// ─────────────────────────────────────────────────────────
describe('resolveTranslations() — custom translations', () => {
  const customEn: TranslationStrings = {
    ...en,
    banner: { ...en.banner, title: 'Custom English Title' },
  };

  const customSv: TranslationStrings = {
    ...sv,
    banner: { ...sv.banner, title: 'Anpassad svensk titel' },
  };

  it('returns a custom translation when an exact match is found', () => {
    const t = resolveTranslations('en', { en: customEn });
    expect(t.banner.title).toBe('Custom English Title');
  });

  it('prefers custom over built-in for the same language code', () => {
    const t = resolveTranslations('en', { en: customEn });
    expect(t.banner.title).not.toBe(en.banner.title);
  });

  it('returns a custom Swedish translation when language is "sv"', () => {
    const t = resolveTranslations('sv', { sv: customSv });
    expect(t.banner.title).toBe('Anpassad svensk titel');
  });

  it('uses custom translation with locale sub-tag stripping', () => {
    // Provide custom under base 'en', request 'en-US' — should match base
    const t = resolveTranslations('en-US', { en: customEn });
    expect(t.banner.title).toBe('Custom English Title');
  });

  it('checks exact locale key before base key in custom translations', () => {
    const customEnUS: TranslationStrings = {
      ...en,
      banner: { ...en.banner, title: 'en-US specific title' },
    };
    // Both 'en-US' exact and 'en' base are provided; exact match should win
    const t = resolveTranslations('en-US', { 'en-US': customEnUS, en: customEn });
    expect(t.banner.title).toBe('en-US specific title');
  });

  it('falls back to built-in if custom object does not contain the requested language', () => {
    const t = resolveTranslations('sv', { en: customEn });
    expect(t.banner.title).toBe(sv.banner.title);
  });

  it('falls back to English if neither custom nor built-in has the language', () => {
    const t = resolveTranslations('ko', { fr: customEn });
    expect(t).toBe(en);
  });
});

// ─────────────────────────────────────────────────────────
// resolveTranslations — language detection from HTML lang
// ─────────────────────────────────────────────────────────
describe('resolveTranslations() — language detection from document.documentElement.lang', () => {
  afterEach(() => {
    clearHtmlLang();
  });

  it('detects "sv" from document.documentElement.lang when no explicit language given', () => {
    setHtmlLang('sv');
    const t = resolveTranslations(undefined);
    expect(t.banner.title).toBe(sv.banner.title);
  });

  it('detects "en" from document.documentElement.lang', () => {
    setHtmlLang('en');
    const t = resolveTranslations(undefined);
    expect(t.banner.title).toBe(en.banner.title);
  });

  it('strips locale sub-tag from HTML lang attribute ("sv-SE" -> "sv")', () => {
    setHtmlLang('sv-SE');
    const t = resolveTranslations(undefined);
    expect(t.banner.title).toBe(sv.banner.title);
  });

  it('falls back to English for an unknown lang attribute', () => {
    setHtmlLang('xx');
    const t = resolveTranslations(undefined);
    expect(t).toBe(en);
  });
});

// ─────────────────────────────────────────────────────────
// Translation content spot-checks
// ─────────────────────────────────────────────────────────
describe('English translation content', () => {
  it('has all required banner fields', () => {
    expect(en.banner.title).toBeTruthy();
    expect(en.banner.description).toBeTruthy();
    expect(en.banner.acceptAll).toBeTruthy();
    expect(en.banner.rejectAll).toBeTruthy();
    expect(en.banner.settings).toBeTruthy();
  });

  it('has all required preference fields', () => {
    expect(en.preferences.title).toBeTruthy();
    expect(en.preferences.save).toBeTruthy();
    expect(en.preferences.acceptAll).toBeTruthy();
  });

  it('has translations for the four default categories', () => {
    expect(en.categories.necessary).toBeDefined();
    expect(en.categories.analytics).toBeDefined();
    expect(en.categories.marketing).toBeDefined();
    expect(en.categories.preferences).toBeDefined();
  });

  it('has a trigger ariaLabel', () => {
    expect(en.trigger.ariaLabel).toBeTruthy();
  });

  it('has an alwaysOnLabel', () => {
    expect(en.alwaysOnLabel).toBeTruthy();
  });
});

describe('Swedish translation content', () => {
  it('has all required banner fields', () => {
    expect(sv.banner.title).toBeTruthy();
    expect(sv.banner.description).toBeTruthy();
    expect(sv.banner.acceptAll).toBeTruthy();
    expect(sv.banner.rejectAll).toBeTruthy();
    expect(sv.banner.settings).toBeTruthy();
  });

  it('has distinct strings from English', () => {
    expect(sv.banner.title).not.toBe(en.banner.title);
    expect(sv.banner.acceptAll).not.toBe(en.banner.acceptAll);
  });

  it('has translations for the four default categories', () => {
    expect(sv.categories.necessary).toBeDefined();
    expect(sv.categories.analytics).toBeDefined();
    expect(sv.categories.marketing).toBeDefined();
    expect(sv.categories.preferences).toBeDefined();
  });
});
