import type { ConsentService } from '../src/core/types.js';

export function umami(options?: { url?: string }): { service: ConsentService } {
  return {
    service: {
      id: 'umami',
      label: 'Umami Analytics',
      description: 'Privacy-friendly, cookieless web analytics (self-hosted)',
      cookies: [], // Umami sets no cookies
      scripts: options?.url
        ? [`${options.url}/script.js`]
        : ['cloud.umami.is/script.js'],
    },
  };
}
