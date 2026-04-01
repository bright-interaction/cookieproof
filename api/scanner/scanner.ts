import { KNOWN_COOKIES, KNOWN_SCRIPTS, type KnownCookie, type KnownScript } from './cookie-database.js';

export interface ScanResult {
  url: string;
  scannedAt: number;
  scripts: DetectedScript[];
  cookies: DetectedCookie[];
  categories: CategorySummary[];
}

export interface DetectedScript {
  src: string;
  provider: string;
  service: string;
  category: string;
}

export interface DetectedCookie {
  name: string;
  provider: string;
  service: string;
  category: string;
  purpose: string;
  expiry: string;
}

export interface CategorySummary {
  id: string;
  label: string;
  cookies: DetectedCookie[];
  scripts: DetectedScript[];
}

/**
 * Scan HTML content for known tracking scripts and infer cookies.
 * This is a static analysis -- it checks script src attributes and inline script content
 * against the known scripts database, then maps those to known cookies.
 */
export function scanHtml(html: string, url: string): ScanResult {
  const detectedScripts: DetectedScript[] = [];
  const detectedServices = new Set<string>();

  // Extract all script src attributes
  const srcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = srcRegex.exec(html)) !== null) {
    const src = match[1];
    for (const known of KNOWN_SCRIPTS) {
      if (src.includes(known.pattern)) {
        detectedScripts.push({
          src,
          provider: known.provider,
          service: known.service,
          category: known.category,
        });
        detectedServices.add(known.service);
        break;
      }
    }
  }

  // Also check inline script content for common patterns
  // Cap each script block at 1 MB to prevent ReDoS with pathological inputs
  const inlineRegex = /<script[^>]*>([\s\S]{0,1048576}?)<\/script>/gi;
  while ((match = inlineRegex.exec(html)) !== null) {
    const content = match[1];
    const inlinePatterns: { pattern: RegExp; service: string; provider: string; category: 'analytics' | 'marketing' | 'preferences' | 'necessary' }[] = [
      { pattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-/i, service: 'Google Analytics 4', provider: 'Google', category: 'analytics' },
      { pattern: /gtag\s*\(\s*['"]config['"]\s*,\s*['"]UA-/i, service: 'Google Analytics (UA)', provider: 'Google', category: 'analytics' },
      { pattern: /fbq\s*\(\s*['"]init['"]/i, service: 'Meta Pixel', provider: 'Meta', category: 'marketing' },
      { pattern: /_linkedin_partner_id/i, service: 'LinkedIn Insight Tag', provider: 'LinkedIn', category: 'marketing' },
      { pattern: /ttq\.load/i, service: 'TikTok Pixel', provider: 'TikTok', category: 'marketing' },
      { pattern: /hj\s*\(\s*['"]init['"]/i, service: 'Hotjar', provider: 'Hotjar', category: 'analytics' },
      { pattern: /_hjSettings/i, service: 'Hotjar', provider: 'Hotjar', category: 'analytics' },
      { pattern: /clarity\s*\(\s*["']set["']/i, service: 'Microsoft Clarity', provider: 'Microsoft', category: 'analytics' },
      { pattern: /analytics\.identify/i, service: 'Segment', provider: 'Segment', category: 'analytics' },
      { pattern: /mixpanel\.init/i, service: 'Mixpanel', provider: 'Mixpanel', category: 'analytics' },
      { pattern: /twq\s*\(\s*['"]init['"]/i, service: 'Twitter/X Pixel', provider: 'Twitter/X', category: 'marketing' },
    ];

    for (const p of inlinePatterns) {
      if (p.pattern.test(content) && !detectedServices.has(p.service)) {
        detectedScripts.push({
          src: '(inline)',
          provider: p.provider,
          service: p.service,
          category: p.category,
        });
        detectedServices.add(p.service);
      }
    }
  }

  // Map detected services to their known cookies
  const detectedCookies: DetectedCookie[] = [];
  for (const cookie of KNOWN_COOKIES) {
    if (detectedServices.has(cookie.service)) {
      detectedCookies.push({
        name: cookie.name,
        provider: cookie.provider,
        service: cookie.service,
        category: cookie.category,
        purpose: cookie.purpose,
        expiry: cookie.expiry,
      });
    }
  }

  // Also add infrastructure cookies that are always present
  const infraCookies = KNOWN_COOKIES.filter(c => c.category === 'necessary' && c.service !== 'cookieproof');
  // Check HTML for service-specific patterns (regex to avoid false positives from
  // generic substrings like 'cf-' matching CSS classes)
  const infraPatterns: Record<string, RegExp[]> = {
    'Stripe': [/js\.stripe\.com/i, /stripe\.com\/v3/i],
    'Cloudflare': [/cdnjs\.cloudflare\.com/i, /cloudflare-static/i, /challenges\.cloudflare\.com/i],
    'Cloudflare Bot Management': [/cdnjs\.cloudflare\.com/i, /challenges\.cloudflare\.com/i, /data-cfasync/i],
  };
  for (const cookie of infraCookies) {
    const patterns = infraPatterns[cookie.service];
    if (patterns && patterns.some(p => p.test(html)) && !detectedCookies.some(d => d.name === cookie.name)) {
      detectedCookies.push({
        name: cookie.name,
        provider: cookie.provider,
        service: cookie.service,
        category: cookie.category,
        purpose: cookie.purpose,
        expiry: cookie.expiry,
      });
    }
  }

  // Build category summaries
  const categoryMap = new Map<string, CategorySummary>();
  const categoryLabels: Record<string, string> = {
    necessary: 'Necessary',
    analytics: 'Analytics',
    marketing: 'Marketing',
    preferences: 'Preferences',
  };

  for (const cat of ['necessary', 'analytics', 'marketing', 'preferences']) {
    categoryMap.set(cat, {
      id: cat,
      label: categoryLabels[cat],
      cookies: detectedCookies.filter(c => c.category === cat),
      scripts: detectedScripts.filter(s => s.category === cat),
    });
  }

  return {
    url,
    scannedAt: Date.now(),
    scripts: detectedScripts,
    cookies: detectedCookies,
    categories: [...categoryMap.values()].filter(c => c.cookies.length > 0 || c.scripts.length > 0),
  };
}
