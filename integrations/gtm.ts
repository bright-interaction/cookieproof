import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function gtm(containerId?: string) {
  return {
    service: {
      id: 'gtm',
      label: 'Google Tag Manager',
      description: 'Tag management system by Google',
      cookies: [],
      scripts: containerId
        ? [`googletagmanager.com/gtm.js?id=${containerId}`]
        : ['googletagmanager.com/gtm.js'],
    } as ConsentService,
    gcm: {
      analytics: ['analytics_storage'],
      marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
    } as Record<string, GCMSignal[]>,
  };
}
