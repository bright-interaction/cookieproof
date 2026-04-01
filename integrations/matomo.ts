import type { ConsentService } from '../src/core/types.js';

export function matomo(options?: { url?: string }): { service: ConsentService } {
  return {
    service: {
      id: 'matomo',
      label: 'Matomo Analytics',
      description: 'Open-source web analytics platform',
      cookies: ['_pk_id.*', '_pk_ses.*', '_pk_ref.*'],
      scripts: options?.url
        ? [`${options.url}/matomo.js`]
        : [],
    },
  };
}
