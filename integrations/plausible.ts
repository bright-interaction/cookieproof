import type { ConsentService } from '../src/core/types.js';

export function plausible(): { service: ConsentService } {
  return {
    service: {
      id: 'plausible',
      label: 'Plausible Analytics',
      description: 'Privacy-friendly, cookieless web analytics',
      cookies: [], // Plausible sets no cookies
      scripts: ['plausible.io/js/script.js'],
    },
  };
}
