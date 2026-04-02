import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function ga4(measurementId?: string): { service: ConsentService; gcm: Record<string, GCMSignal[]> } {
  return {
    service: {
      id: 'ga4',
      label: 'Google Analytics 4',
      description: 'Website usage analytics by Google',
      cookies: ['_ga', '_ga_*', '_gid', '_gac_*'],
      scripts: measurementId
        ? [`googletagmanager.com/gtag/js?id=${measurementId}`]
        : ['googletagmanager.com/gtag/js'],
    },
    gcm: { analytics: ['analytics_storage'] },
  };
}
