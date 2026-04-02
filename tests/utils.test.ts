import { describe, it, expect } from 'vitest';
import { esc, escAttr, safeId } from '../src/ui/utils.js';

// ─────────────────────────────────────────────────────────
// esc() — HTML text content escaping
// ─────────────────────────────────────────────────────────
describe('esc()', () => {
  it('escapes & to &amp;', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('escapes < to &lt;', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(esc('foo > bar')).toBe('foo &gt; bar');
  });

  it('escapes multiple special characters in one string', () => {
    expect(esc('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('escapes double-quotes to &quot;', () => {
    expect(esc('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single-quotes to &#39;', () => {
    expect(esc("it's fine")).toBe("it&#39;s fine");
  });

  it('returns an empty string unchanged', () => {
    expect(esc('')).toBe('');
  });

  it('returns a string with no special chars unchanged', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  it('handles a string that is only special characters', () => {
    expect(esc('&<>')).toBe('&amp;&lt;&gt;');
  });

  it('handles multiple consecutive & characters', () => {
    expect(esc('a && b')).toBe('a &amp;&amp; b');
  });

  it('is idempotent — does not double-encode already-escaped entities', () => {
    // It should encode the & in &amp; again, because the input is treated as raw text
    expect(esc('&amp;')).toBe('&amp;amp;');
  });
});

// ─────────────────────────────────────────────────────────
// escAttr() — HTML attribute value escaping
// ─────────────────────────────────────────────────────────
describe('escAttr()', () => {
  it('escapes & to &amp;', () => {
    expect(escAttr('a & b')).toBe('a &amp; b');
  });

  it('escapes < to &lt;', () => {
    expect(escAttr('<value>')).toBe('&lt;value&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(escAttr('foo > bar')).toBe('foo &gt; bar');
  });

  it('escapes " to &quot;', () => {
    expect(escAttr('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('escapes all five special characters together', () => {
    expect(escAttr(`"<a & b>'"it's"`)).toBe('&quot;&lt;a &amp; b&gt;&#39;&quot;it&#39;s&quot;');
  });

  it('escapes single-quotes to &#39;', () => {
    expect(escAttr("it's fine")).toBe("it&#39;s fine");
  });

  it('returns an empty string unchanged', () => {
    expect(escAttr('')).toBe('');
  });

  it('returns a string with no special chars unchanged', () => {
    expect(escAttr('plain text')).toBe('plain text');
  });

  it('escapes a URL with & query params correctly', () => {
    const url = 'https://example.com?a=1&b=2';
    expect(escAttr(url)).toBe('https://example.com?a=1&amp;b=2');
  });

  it('handles a string that is only a double-quote', () => {
    expect(escAttr('"')).toBe('&quot;');
  });
});

// ─────────────────────────────────────────────────────────
// safeId() — HTML id attribute sanitization
// ─────────────────────────────────────────────────────────
describe('safeId()', () => {
  it('passes through alphanumeric strings unchanged', () => {
    expect(safeId('analytics')).toBe('analytics');
  });

  it('passes through hyphens and underscores', () => {
    expect(safeId('my-category_1')).toBe('my-category_1');
  });

  it('replaces special characters with underscore', () => {
    expect(safeId('cat&id')).toBe('cat_id');
  });

  it('replaces spaces with underscore', () => {
    expect(safeId('my category')).toBe('my_category');
  });

  it('replaces HTML entities-like strings', () => {
    expect(safeId('foo"bar<baz>')).toBe('foo_bar_baz_');
  });

  it('handles empty string', () => {
    expect(safeId('')).toBe('');
  });

  it('handles strings that are entirely special characters', () => {
    expect(safeId('&<>"\'')).toBe('_____');
  });
});
