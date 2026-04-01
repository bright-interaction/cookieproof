import type { ConsentService, GCMSignal } from '../src/core/types.js';

export function mixpanel(token?: string) {
  return {
    service: {
      id: 'mixpanel',
      label: 'Mixpanel',
      description: 'Product analytics for tracking user interactions',
      cookies: ['mp_*_mixpanel'],
      scripts: ['cdn.mxpnl.com/libs/mixpanel-2-latest.min.js'],
    } as ConsentService,
    gcm: {
      analytics: ['analytics_storage'],
    } as Record<string, GCMSignal[]>,
    token,
  };
}
